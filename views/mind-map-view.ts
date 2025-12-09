import { App, ItemView, Modal, Notice, SliderComponent, View, WorkspaceLeaf } from 'obsidian';
import { MapProperties, Note, NoteProperties, MindMap, MindMapLayout, createMindMap, NoteGroup } from 'types';
import { toPathString } from 'helpers';
import * as d3 from 'd3';
import { Card, fsrs, FSRS, generatorParameters, RecordLog } from 'ts-fsrs';

export const VIEW_TYPE_MIND_MAP = 'mind-map-view';
const MIN_ALPHA = 0.005;
const DEFAULT_ALPHADECAY = 0.30; // 1 - Math.pow(0.005, 1 / 30)
const INITIAL_ALPHA = 0.5;
const INITIAL_ALPHADECAY = 0.16
const DRAG_ALPHA = 0.2;
const DRAG_ALPHADECAY = 0.30;

interface Node extends d3.SimulationNodeDatum {
  id: string;
  content: string;
  level: number;
  study: boolean;
  centre: boolean;
  // fx: number | null;
  // fy: number | null;
}

interface Link extends d3.SimulationLinkDatum<Node> {
  source: string | Node;
  target: string | Node;
  level: number;
}

interface Chain {
  parent: string; // id of parent
  nodes: string[] // array of nodes in the chain
}

// interface Alias {
//   id: string;
//   node: string;
// }

interface NodeCard extends Card {
  source: string;
  target: string;
  depth: number;
  listIndex: number;
}

enum ViewMode {
  Navigate, 
  Arrange,
};

enum SearchType {
  DepthFirst, 
  BreadthFirst, 
}

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
const COLOUR_DIVISIONS = 10;
const colour = (level: number) => {
  // const value = 255 / (level + 1);
  // return `rgb(${value} ${value} ${value})`;
  return d3.interpolateRainbow((level % COLOUR_DIVISIONS) / COLOUR_DIVISIONS);
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

  searchType = SearchType.DepthFirst;
  searchTypeButton: Element;
  searchTypeButtonHandler: () => void;

  viewModeButton: Element;
  viewMode = ViewMode.Navigate;
  viewModeButtonHandler: () => void;

  simulationButton: Element;
  simulationRunning = false;
  simulationButtonHandler: () => void;

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
    this.mindMap = {} as MindMap;
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

    this.searchTypeButton = document.createElement('button');
    this.searchTypeButton.textContent = "Search type: Depth-first";
    this.searchTypeButtonHandler = () => this.changeSearchType();
    this.searchTypeButton.addEventListener('click', this.searchTypeButtonHandler);

    this.viewModeButton = document.createElement('button');
    this.viewModeButton.textContent = "Mode: Navigate";
    this.viewModeButtonHandler = () => this.changeViewMode();
    this.viewModeButton.addEventListener('click', this.viewModeButtonHandler);

    this.simulationButton = document.createElement('button');
    this.simulationButton.textContent = "Run simulation";
    this.simulationButtonHandler = () => this.toggleSimulation();
    this.simulationButton.addEventListener('click', this.simulationButtonHandler);

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
      actionsContainer.appendChild(this.searchTypeButton);
      actionsContainer.appendChild(this.viewModeButton);
      actionsContainer.appendChild(this.simulationButton);
    }

    this.width = this.graphContainer.clientWidth;
    this.height = this.graphContainer.clientHeight;
  }

  async onClose() {
    // Nothing to clean up.
    this.graphContainer.removeEventListener('resize', this.resize);
    this.studyButton.removeEventListener("click", this.studyButtonHandler);
    this.studyButton.remove();
    this.searchTypeButton.removeEventListener('click', this.searchTypeButtonHandler);
    this.searchTypeButton.remove();
    this.viewModeButton.removeEventListener('click', this.viewModeButtonHandler);
    this.viewModeButton.remove();
    this.simulationButton.removeEventListener('click', this.simulationButtonHandler);
    this.simulationButton.remove();
  }

  onResize() {
    this.resize();
  }

  async initialiseMindMap(mindMap: MindMap, layout: MindMapLayout, saveProgressCallback: () => void, saveLayoutCallback: (layout: MindMapLayout) => void) {
    this.mindMap = mindMap;
    this.layout = layout;
    this.saveProgressCallback = saveProgressCallback;
    this.saveLayoutCallback = saveLayoutCallback;
    
    const presetLayout = layout.ids.length != 0;

    this.nodes = [];
    this.links = [];

    // add central node (title)
    let centreNode = {} as Node;
    if (!mindMap.map.settings.separateHeadings) {
      centreNode = {
        id: this.mindMap.map.id, 
        content: this.mindMap.map.title, 
        level: 0,
        study: false, 
        centre: true, 
        x: 0, 
        y: 0, 
        fx: 0, 
        fy: 0, 
      }
      this.nodes.push(centreNode);
      // console.log(centreNode);
    }

    // preprocessing
    const groups: NoteGroup[] = [];
    const chains: Chain[] = [];
    let index = 0;
    for (let note of this.mindMap.notes) {
      // add id groups
      if (note.id) {
        const groupIndex = groups.findIndex((group) => group.id === note.id);
        if (groupIndex == -1) { // no matching id
          groups.push({
            content: note.content, 
            id: note.id, 
            indices: [index], 
            levels: [], 
            ref: index,
          });
        } else {
          groups[groupIndex].indices.push(index);
          // make this note the reference if it has children or is before a note
          const level = note.props.path.length;
          const nextIndex = index + 1;
          if (nextIndex < this.mindMap.notes.length) {
            const next = this.mindMap.notes[nextIndex];
            if (
              level < next.props.path.length ||
              (level == next.props.path.length && note.listIndex == next.listIndex - 1)
            ) groups[groupIndex].ref = index;
          }
        }
      }
      index++;

      // find chains
      const listIndex = note.listIndex;
      if (listIndex == 0) continue;

      let id = toPathString(note.props.path);
      let parent = toPathString(note.props.path.slice(0, -1));
      if (note.props.path.length == 1) { // top level note 
        if (this.mindMap.map.settings.separateHeadings) { // must have centre node
          new Notice("Must not separate headings if top level notes are in a chain.");
          console.log("initialiseMindMap() Error: chain at top level does not have centre node");
          return;
        } else {
          parent = centreNode.id;
        }
      }

      // add to chain array
      const chainIndex = chains.findIndex((chain) => chain.parent === parent);
      if (chainIndex != -1) {
        chains[chainIndex].nodes[listIndex - 1] = id; // assign chain
      } else {
        let i = chains.push({
          parent, 
          nodes: []
        });
        chains[i - 1].nodes[listIndex - 1] = id;
      }
    }

    // verify chains
    for (let chain of chains) {
      for (let i = 0; i < chain.nodes.length; i++) {
        if (chain.nodes[i] == undefined) {
          console.log("initialiseMindMap() Error: chain entry missing.");
          return;
        }
      }
    }

    // populate nodes and links
    index = 0;
    for (let note of this.mindMap.notes) {
      let nodeId: string;
      const path = note.props.path;
      let crosslink = false;
      // check crosslinks
      if (note.id) {
        const groupIndex = groups.findIndex((group) => group.id === note.id)
        const refIndex = groups[groupIndex].ref;
        const ref = this.mindMap.notes[refIndex];
        nodeId = toPathString(ref.props.path);
        crosslink = refIndex != index; // link goes to the reference node
      } else {
        nodeId = toPathString(path);
      }
      index++;

      let level = 0; // key word depth of the node
      level = path.length - 1;
      let pathBuffer = path.slice(0, -1);
      // count how many key words there are before the node
      // while (pathBuffer.length > 0) {
      //   let targetId = toPathString(pathBuffer);
      //   let target = mindMap.notes.find((note) => toPathString(note.props.path) === targetId);
      //   if (target?.type === 'key word') { // note is a keyword
      //     level++; // decrement study level
      //   }
      //   pathBuffer.pop();
      // }
      // if (note.type === 'key word') level++;

      let study = note.props.study;

      if (!crosslink) { // only add nodes when note has content ()
        const node: Node = {
          id: nodeId, 
          content: note.content, 
          level: note.type === 'key word' ? level +  1 : level, 
          study, 
          centre: false, 
        };
        if (presetLayout) {
          const nodeIndex = layout.ids.findIndex((value) => value === nodeId);
          if (nodeIndex != -1) {
            node.x = layout.xCoords[nodeIndex];
            node.y = layout.yCoords[nodeIndex];
          }
        }
        this.nodes.push(node);
      }

      // separate headings
      if (mindMap.map.settings.separateHeadings && note.props.path.length == 1) continue;

      // link node to parent
      let listIndex = note.listIndex;
      let parent = path.length == 1 ? centreNode!.id : toPathString(note.props.path.slice(0, -1));
      let source = parent;
      let depth = note.props.path.length;
      if (listIndex > 1) { // node in a chain
        let chainIndex = chains.findIndex((group) => group.parent === parent);
        // console.log(parent, chainIndex);
        source = chains[chainIndex].nodes[listIndex - 2];
      }
      this.links.push({
        source, target: nodeId, level: listIndex > 1 ? level + 1 : level, 
      });
      // console.log(`created link ${source} -> ${nodeId}`);
      if (study) {
        this.cards.push({
          source, target: nodeId, depth, listIndex, 
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

    // const root = d3.hierarchy()

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
        .attr('stroke', d => colour(d.level))
        .attr('stroke-width', 2);
    this.node = this.svg.append('g')
      .selectAll<SVGCircleElement, Node>('circle')
      .data(this.nodes)
      .join('circle')
        .attr('nodeId', d => d.id)
        .attr('fill', d => d.centre ? 'white' : d.study ? 'white' : colour(d.level)) // to do: white when before review, filled in when reviewed
        .attr('r', d => d.centre ? 10 : (d.study ? size(d.level) : 3))
        .attr("stroke", d => d.centre ? 'white' : colour(d.level))
        .attr("stroke-width", 1)
      .on('click', (event, d) => {
        event.stopPropagation();
        if (this.viewMode == ViewMode.Arrange) return;
        // event.stopPropagation();
        if (d.centre) {
          this.focusNodes();
          return;
        }
        // console.log("node.click: filtering by children of", d.id);
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
      // .on('hover', )

    this.focusNodes();
  }

  updateGraph() {
    if (this.simulationRunning) {
      this.simulation.alphaTarget(INITIAL_ALPHA);
    }
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
      // console.log("MindMapView.updateGraph(): graph settled in", this.stepsToAnneal, "steps");
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
    
    // console.log("MindMapView.saveLayout(): layout", this.layout);
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
    const frameWidth = maxX - minX;
    const frameHeight = maxY - minY;
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

  toggleSimulation() {
    this.simulationRunning = !this.simulationRunning;
    if (this.simulationRunning) {
      this.simulationButton.textContent = "Stop simulation";
      this.simulation.alphaTarget(INITIAL_ALPHA).restart();
    } else {
      this.simulationButton.textContent = "Run simulation";
      this.simulation.alphaTarget(0).alphaDecay(DRAG_ALPHADECAY);
    }
  }

  changeSearchType() {
    switch(this.searchType) {
      case SearchType.BreadthFirst:
        this.searchType = SearchType.DepthFirst;
        this.searchTypeButton.textContent = "Search type: Depth-first";
        break;
      case SearchType.DepthFirst:
        this.searchType = SearchType.BreadthFirst;
        this.searchTypeButton.textContent = "Search type: Breadth-first";
        break;
    }
  }

  generateSchedule() {
    const now = new Date().getTime();
    const due = this.cards.filter((card) => card.due.getTime() < now);
    // console.log("generateSchedule() cards that are due:", due.map((card) => card.source + "->" + card.target));

    switch(this.searchType) {
      case SearchType.BreadthFirst: // complete every level before going further
        due.sort((a, b) => 
          a.depth < b.depth ? -1 : // sort by depth
          a.depth > b.depth ? 1 :
          a.source < b.source ? -1 : // sort by source (alphabetical)
          a.source > b.source ? 1 : 
          a.listIndex < b.listIndex ? -1 : 
          a.listIndex > b.listIndex ? 1 : 
          0);
        break;
      case SearchType.DepthFirst: // complete a set of a source, then pick one of the targets

    }
    console.log("generateSchedule() cards sorted", due.map((card) => card.source + " -> " + card.target.split('\\').last()));
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