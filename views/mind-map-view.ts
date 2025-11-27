import { App, ItemView, Modal, SliderComponent, View, WorkspaceLeaf } from 'obsidian';
import { MapProperties, Note, NoteProperties, MindMap, MindMapLayout, createMindMap } from 'types';
import { toPathString } from 'helpers';
import * as d3 from 'd3';
import { Card, fsrs, FSRS, generatorParameters, RecordLog } from 'ts-fsrs';

export const VIEW_TYPE_MIND_MAP = 'mind-map-view';
const MIN_ALPHA = 0.005;
const DEFAULT_ALPHADECAY = 0.30; // 1 - Math.pow(0.005, 1 / 30)
const INITIAL_ALPHA = 1;
const INITIAL_ALPHADECAY = 0.16
const DRAG_ALPHA = 0.5;
const DRAG_ALPHADECAY = 0.30;

interface Node extends d3.SimulationNodeDatum {
  id: string;
  content: string;
  level: number;
  isRelation: boolean;
  centre: boolean;
  // fx: number | null;
  // fy: number | null;
}

interface Link extends d3.SimulationLinkDatum<Node> {
  source: string | Node;
  target: string | Node;
}

interface ChainGroup {
  parent: string; // id of parent
  nodes: string[] // array of nodes in the chain
}

interface NodeCard extends Card {
  source: string;
  target: string;
  depth: number;
}

enum ViewMode {
  Navigate, 
  Arrange,
};

const levelColour = [
  'red', 
  'orange', 
  'yellow', 
  'green', 
  'blue', 
  'indigo', 
  'violet',
];

const COLOUR_STROKE = 'lightgrey';

const colour = (level: number) => {
  // const value = 255 / (level + 1);
  // return `rgb(${value} ${value} ${value})`;
  return d3.interpolateRainbow((level % 6) / 6);
}

const size = (level: number) => 4 + 6 / (level + 1);

export class MindMapView extends ItemView {
  mindMap: MindMap;
  nodes: Node[];
  links: Link[];
  cards: NodeCard[];

  graphContainer: Element;
  simulation: d3.Simulation<Node, Link>;
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  link: d3.Selection<SVGLineElement, Link, SVGGElement, unknown>;
  node: d3.Selection<SVGCircleElement, Node, SVGGElement, unknown>;
  label: d3.Selection<SVGTextElement, Node, SVGElement, unknown>;
  zoom: d3.ZoomBehavior<SVGSVGElement, unknown>;

  width = 480;
  height = 360;
  marginTop = 20;
  marginRight = 20;
  marginBottom = 30;
  marginLeft = 40;
  stepsToAnneal: number;

  settingsContainer: Element;
  studyButton: Element;
  studyButtonHandler: () => void;

  viewModeButton: Element;
  viewMode = ViewMode.Navigate;
  viewModeButtonHandler: () => void;

  layout: MindMapLayout;
  saveProgressCallback: () => void;
  saveLayoutCallback: (layout: MindMapLayout) => void;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_MIND_MAP;
  }

  getDisplayText() {
    return 'Mind map';
  }

  async onOpen() {
    this.mindMap = createMindMap()
    this.nodes = [];
    this.links = [];
    this.cards = [];
    
    this.graphContainer = document.createElement('div');
    this.graphContainer.addClass('mind-map-view-graph-container');
    this.settingsContainer = document.createElement('div');
    this.settingsContainer.addClass('mind-map-view-settings-container');

    this.studyButton = document.createElement('button');
    this.studyButton.textContent = "Study";
    this.studyButtonHandler = () => this.generateSchedule();
    this.studyButton.addEventListener('click', this.studyButtonHandler);

    this.viewModeButton = document.createElement('button');
    this.viewModeButton.textContent = "Mode: Navigate";
    this.viewModeButtonHandler = () => this.changeViewMode();
    this.viewModeButton.addEventListener('click', this.viewModeButtonHandler);

    const container = this.containerEl.children[1];
    container.addClass('mind-map-view-container');
    container.empty();
    container.appendChild(this.graphContainer);
    container.appendChild(this.settingsContainer);

    const header = this.containerEl.querySelector(".view-header") as HTMLElement | null;
    if (header) {
      const actionsContainer =
        header.querySelector(".view-actions") ||
        header.querySelector(".view-header-actions") ||
        header;
      actionsContainer.appendChild(this.studyButton);
      actionsContainer.appendChild(this.viewModeButton);
    }
  }

  async onClose() {
    // Nothing to clean up.
    this.graphContainer.removeEventListener('resize', this.resize);
    this.studyButton.removeEventListener("click", this.studyButtonHandler);
    this.studyButton.remove();
    this.viewModeButton.removeEventListener('click', this.viewModeButtonHandler);
    this.viewModeButton.remove();
  }

  onResize() {
    this.resize();
  }

  initialiseMindMap(mindMap: MindMap, layout: MindMapLayout, saveProgressCallback: () => void, saveLayoutCallback: (layout: MindMapLayout) => void) {
    console.log(this.mindMap);
    this.mindMap = mindMap;
    this.layout = layout;
    this.saveProgressCallback = saveProgressCallback;
    this.saveLayoutCallback = saveLayoutCallback;
    
    const presetLayout = layout.ids.length != 0;

    this.nodes = [];
    this.links = [];

    // add central node (title)
    let centreNode: Node;
    if (!mindMap.map.settings.separateHeadings) {
      centreNode = {
        id: this.mindMap.map.id, 
        content: this.mindMap.map.title, 
        level: 0,
        isRelation: false, 
        centre: true, 
        x: 0, 
        y: 0, 
        fx: 0, 
        fy: 0, 
      }
      this.nodes.push(centreNode);
      // console.log("map:", this.mindMap.map.id);
    }

    // preprocessing step:
    // find chain nodes
    const chains: ChainGroup[] = [];
    for (let note of this.mindMap.notes) {
      let listIndex = note.props.listIndex;
      if (listIndex == 0) continue;
      let id = note.props.id ? note.props.id : toPathString(note.props.path);
      let parent = toPathString(note.props.path.slice(0, -1));
      let chainIndex = chains.findIndex((group) => group.parent === parent);
      if (chainIndex != -1) {
        chains[chainIndex].nodes[listIndex - 1] = id;
      } else {
        let i = chains.push({
          parent: parent, 
          nodes: []
        });
        chains[i - 1].nodes[listIndex - 1] = id;
        // console.log("added chain group with parent:", parent);
      }
    }
    for (let group of chains) {
      group.nodes.forEach((id) => {
        if (!id) {
          console.log("MindMapView.createMindMap() Error: chain entry missing.");
          return;
        }
      });
    }
    console.log("createMindMap(): chain groups:", chains);

    // add notes
    const nodeIDs: string[] = [];
    for (let note of this.mindMap.notes) {
      let path = toPathString(note.props.path);
      let id = path;
      if (note.props.id && mindMap.map.settings.crosslink) { // note has predetermined node id AND crosslinking enabled
        id = note.props.id;
      }

      if (!nodeIDs.contains(id)) { // only add unique nodes
        let level = note.props.path.length; // study depth of the node
        let pathBuffer = note.props.path.slice(0, level);
        // console.log(toPathString(pathBuffer), "level:", level);
        while (pathBuffer.length > 0) {
          let targetId = toPathString(pathBuffer);
          let target = mindMap.notes.find((note) => toPathString(note.props.path) === targetId);
          if (!target?.content.endsWith(':')) { // note is a keyword
            // console.log(`note not studyable id: ${targetId}`);
            level--; // decrement study level
          }
          pathBuffer.pop();
        }
        // console.log("level:", level);
        const node: Node = {
          id: id, 
          content: note.content, 
          level: level, 
          isRelation: note.content.endsWith(':'), 
          centre: false, 
        };
        if (presetLayout) {
          const nodeIndex = layout.ids.findIndex((value) => value === id);
          if (nodeIndex != -1) {
            node.x = layout.xCoords[nodeIndex];
            node.y = layout.yCoords[nodeIndex];
          }
        }
        this.nodes.push(node);
        nodeIDs.push(id);
      }

      // no links
      if (mindMap.map.settings.separateHeadings && note.props.path.length == 1) continue;

      // link node to parent
      let listIndex = note.props.listIndex;
      let parent = note.props.path.length == 1 ? centreNode!.id : toPathString(note.props.path.slice(0, -1));
      
      if (listIndex > 1) { // node in a chain
        let chainIndex = chains.findIndex((group) => group.parent === parent);
        const link = {
          source: chains[chainIndex].nodes[listIndex - 2],
          target: id
        };
        this.links.push(link);
        this.cards.push({
          ...link, 
          depth: note.props.path.length, 
          ...note.props.card!
        });
      } else { // nodes not in a chain
        this.links.push({
          source: parent,
          target: id
        });
        this.cards.push({
          source: parent,
          target: id, 
          depth: note.props.path.length, 
          ...note.props.card!
        });
      }
    }
    // console.log("createMindMap(): created cards", this.cards);

    // console.log(this.nodes);
    // console.log(this.links);
    this.createGraph();
  }

  async createGraph() {
    const presetLayout = this.layout.ids.length != 0;
    console.log("MindMapView.createGraph(): preset layout:", presetLayout);

    this.simulation = d3.forceSimulation<Node>(this.nodes)
      .force('link', d3.forceLink<Node, Link>(this.links).id(d => d.id))
      .force('charge', d3.forceManyBody().strength(-100).theta(0.9).distanceMax(100))
      .alpha(presetLayout ? 0 : INITIAL_ALPHA)
      .alphaDecay(INITIAL_ALPHADECAY)
      .alphaMin(MIN_ALPHA)
      .on('tick', () => this.updateGraph());
      
    this.graphContainer.empty();

    
    // this.resize();
    // console.log("container size", this.graphContainer.clientWidth, this.graphContainer.clientHeight);
    this.svg = d3.select(this.graphContainer)
      .append("svg")
      // .attr("style", "max-width: 100%; height: 100%;")
      .attr("width", "100%")
      .attr("height", "100%")
      // .attr("viewBox", [-this.width / 2, -this.height / 2, this.width, this.height]);
      .attr("viewBox", [-this.width / 2, -this.height / 2, this.width, this.height])
      .on('click', () => this.focusNodes());
    
    this.zoom = d3.zoom<SVGSVGElement, unknown>()
      .extent([[-this.width / 2, -this.height / 2], [this.width / 2, this.height / 2]])
      .scaleExtent([0.1, 2])
      .on("zoom", (event) => this.zoomed(event));
    this.svg.call(this.zoom);
    
    // this.link = this.svg.append('g').selectAll<SVGLineElement, Link>('line');
    // this.node = this.svg.append('g').selectAll<SVGCircleElement, Node>('circle');
    // this.label = this.svg.append('g').selectAll<SVGTextElement, Node>('text');
    this.link = this.svg.append('g')
      .selectAll<SVGLineElement, Link>('line')
      .data(this.links)
      .join('line')
        .attr('stroke', COLOUR_STROKE)
        .attr('stroke-width', 2);
    this.node = this.svg.append('g')
      .selectAll<SVGCircleElement, Node>('circle')
      .data(this.nodes)
      .join('circle')
        .attr('nodeId', d => d.id)
        .attr('fill', d => d.centre ? 'white' : (d.isRelation ? colour(d.level) : /* COLOUR_STROKE */ 'white'))
        .attr('r', d => d.centre ? 10 : (d.isRelation ? size(d.level) : 3))
        .attr("stroke", COLOUR_STROKE)
        .attr("stroke-width", 1)
      .on('click', (event, d) => {
        event.stopPropagation();
        if (this.viewMode == ViewMode.Arrange) return;
        // event.stopPropagation();
        if (d.centre) {
          this.focusNodes();
          return;
        }
        console.log("node.click: filtering by children of", d.id);
        this.focusNodes(d.id);
      })
      .call(d3.drag<SVGCircleElement, Node>()
          .on('start', (event, d) => {
              if (this.viewMode == ViewMode.Navigate) return;
              if (d.centre) return;
              if (!event.active) this.simulation.alphaTarget(DRAG_ALPHA).alphaDecay(DRAG_ALPHADECAY).restart();
              d.fx = d.x ? d.x : null;
              d.fy = d.y ? d.y : null;
          })
          .on('drag', (event, d) => {
              if (d.centre) return;
              d.fx = event.x;
              d.fy = event.y;
          })
          .on('end', (event, d) => {
              if (!event.active) this.simulation.alphaTarget(0);
              d.fx = d.centre ? 0 : null;
              d.fy = d.centre ? 0 : null;
          })
      );
    this.label = this.svg.append('g')
      .selectAll<SVGTextElement, Node>('text')
      .data(this.nodes)
      .join('text')
        .text(d => d.content)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .attr("pointer-events", "none")
        .attr("class", "mindmap-node-label");

    this.focusNodes();
  }

  updateGraph() {
    // Update positions on each tick
    this.simulation.nodes(this.nodes);
    (this.simulation.force('link') as d3.ForceLink<Node, Link>).links(this.links);

    this.link
      .attr('x1', d => (d.source as Node).x!)
      .attr('y1', d => (d.source as Node).y!)
      .attr('x2', d => (d.target as Node).x!)
      .attr('y2', d => (d.target as Node).y!);

    this.node
      .attr('cx', d => d.x!)
      .attr('cy', d => d.y!);

    this.label
      .attr('x', d => d.x!)
      .attr('y', d => d.y!);
    
    let alpha = this.simulation.alpha();
    if (alpha <= MIN_ALPHA) {
      console.log("MindMapView.updateGraph(): graph settled in", this.stepsToAnneal, "steps");
      this.stepsToAnneal = 0;
      this.saveLayout();
    } else {
      this.stepsToAnneal++;
    }
  }

  saveLayout() {
    let id: string;
    let x: number;
    let y: number;
    let i: number;
    for (const node of this.node) {
      id = node.getAttr('nodeId')!;
      x = Math.round(parseFloat(node.getAttr('cx')!)); 
      y = Math.round(parseFloat(node.getAttr('cy')!));
      
      i = this.layout.ids.findIndex((value) => value === id);
      if (i != -1) {
        this.layout.xCoords[i] = x;
        this.layout.yCoords[i] = y;
      } else {
        this.layout.ids.push(id);
        this.layout.xCoords.push(x);
        this.layout.yCoords.push(y);
      }
    }
    // console.log("this.node cx:", this.node.attr('cx', d => xCoords.push(d.x!)));
    // console.log("this.node cy:", this.node.attr('cy', d => yCoords.push(d.y!)));
    
    console.log("MindMapView.saveLayout(): layout", this.layout);
    this.saveLayoutCallback(this.layout);
  }

  resize() {
    this.width = this.graphContainer.clientWidth;
    this.height = this.graphContainer.clientHeight;
    console.log("resize():", this.width, this.height);
    this.svg
      .attr('width', this.width)
      .attr('height', this.height)
      .attr("viewBox", [-this.width / 2, -this.height / 2, this.width, this.height]);
  }

  zoomed(event: d3.D3ZoomEvent<SVGSVGElement, unknown>) {
    const transform = event.transform;
    this.node.attr("transform", transform.toString());
    this.link.attr("transform", transform.toString());
    this.label.attr("transform", transform.toString());
  }

  focusNodes(id?: string) {
    const nodes = id ? this.nodes.filter((node) => node.id.startsWith(id)) : this.nodes;
    // console.log("focusNodes() group size:", nodes.length);

    let minX, maxX, minY, maxY = 0;
    const xCoords = nodes.map((node) => node.x!);
    const yCoords = nodes.map((node) => node.y!);
    minX = Math.min(...xCoords);
    maxX = Math.max(...xCoords);
    minY = Math.min(...yCoords);
    maxY = Math.max(...yCoords);
    // console.log(`frameNodes: corners (${minX}, ${minY}) and (${maxX}, ${maxY})`);
    const frameCentreX = (minX + maxX) * 0.5;
    const frameCentreY = (minY + maxY) * 0.5;
    const frameWidth = maxX - minX + 20;
    const frameHeight = maxY - minY + 20;
    const widthBounded = (this.width / this.height) > (frameWidth / frameHeight); // frame is proportionally wider than the window
    const scaleF = widthBounded ? this.width / frameWidth : this.height / frameHeight;
    
    this.svg.transition().duration(500).call(
      this.zoom.transform, 
      d3.zoomIdentity
        .scale(Math.min(2.0, scaleF * 0.5))
        .translate(-frameCentreX, -frameCentreY),
    );
  }

  changeViewMode() {
    let buttonText = "";
    switch(this.viewMode) {
      case ViewMode.Arrange: 
        this.viewMode = ViewMode.Navigate; 
        buttonText = "Mode: Navigate";
        break;
      case ViewMode.Navigate: 
        this.viewMode = ViewMode.Arrange; 
        buttonText = "Mode: Arrange";
        break;
    }

    this.viewModeButton.textContent = buttonText;
  }

  generateSchedule() {
    const f: FSRS = fsrs(this.mindMap.map.settings.studySettings);
    let schedulingCards: RecordLog;
    const time = new Date();
    this.cards.forEach((card) => f.repeat(card, time));
    console.log("generateSchedule()", f);
  }
}

// class StudyManagerModal extends Modal {
//   constructor(app: App, title: string, studyManagerCallback: (mode: string) => void) {
//     super(app);
//     console.log("Study settings modal created.");

//     this.setTitle(`Study ${title}`);

//     let mode = "smart";
//     new Setting(this.contentEl)
//       .setName("Mode")
//       .addDropdown((dropdown) => dropdown
//         .addOption("smart", "Smart (default)")
//         .addOption("depth-first", "Depth-first")
//         .addOption("breadth-first", "Breadth-first")
//         .addOption("navigate", "Navigate")
//         .onChange((value) => mode = value));

//     new Setting(this.contentEl)
//       .addButton((button) => button
//         .setButtonText("Start!")
//         .setCta()
//         .onClick(() => {
//           this.close();
//           studyManagerCallback(mode);
//         }));
//   }
// }