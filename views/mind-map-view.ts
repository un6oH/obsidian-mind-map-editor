import { App, ItemView, Modal, Setting, SliderComponent, WorkspaceLeaf } from 'obsidian';
import { MapProperties, Note, NoteProperties, MindMap, MindMapLayout } from 'types';
import { toPathString } from 'helpers';
import * as d3 from 'd3';

export const VIEW_TYPE_MIND_MAP = 'mind-map-view';
const MIN_ALPHA = 0.001;
const DEFAULT_ALPHADECAY = 0.2; // 1 - Math.pow(0.001, 1 / 30)

export interface Node extends d3.SimulationNodeDatum {
  id: string;
  content: string;
  level: number;
  study: boolean;
  centre: boolean;
  // fx: number | null;
  // fy: number | null;
}

export interface Link extends d3.SimulationLinkDatum<Node> {
  source: string | Node;
  target: string | Node;
}

interface ChainGroup {
  parent: string; // id of parent
  nodes: string[] // array of nodes in the chain
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

  graphContainer: Element;
  simulation: d3.Simulation<Node, Link>;
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  link: d3.Selection<SVGLineElement, Link, SVGGElement, unknown>;
  node: d3.Selection<SVGCircleElement, Node, SVGGElement, unknown>;
  label: d3.Selection<SVGTextElement, Node, SVGElement, unknown>;

  width = 480;
  height = 360;
  marginTop = 20;
  marginRight = 20;
  marginBottom = 30;
  marginLeft = 40;
  stepsToAnneal: number;

  settingsContainer: Element;

  layout: MindMapLayout;
  saveProgressCallback: () => void;
  saveLayoutCallback: (layout: MindMapLayout) => void;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.nodes = [];
    this.links = [];
  }

  getViewType() {
    return VIEW_TYPE_MIND_MAP;
  }

  getDisplayText() {
    return 'Mind map';
  }

  async onOpen() {
    const app = this.app;
    const container = this.containerEl.children[1];
    container.addClass('mind-map-view-container');
    container.empty();
    this.graphContainer = container.createEl('div');
    this.graphContainer.addClass('mind-map-view-graph-container');
    this.settingsContainer = container.createEl('div');
    this.settingsContainer.addClass('mind-map-view-settings-container');
    
    // settings
    // const strengthSlider = this.settingsContainer.createEl('input');
    // strengthSlider.type = 'range';
    // strengthSlider.min = '0';
    // strengthSlider.max = '4';
    // strengthSlider.addEventListener('change', (ev: InputEvent) => {
      
    // });
    
    // this.graphContainer.addEventListener('resize', this.resize);

    // new StudyManagerModal(this.app, "Mind Map", (mode: string) => console.log("Study started. mode:", mode)).open();
  }

  async onClose() {
    // Nothing to clean up.
    // this.graphContainer.removeEventListener('resize', this.resize);
  }

  createMindMap(mindMap: MindMap, layout: MindMapLayout, saveProgressCallback: () => void, saveLayoutCallback: (layout: MindMapLayout) => void) {
    this.mindMap = mindMap;
    this.layout = layout;
    this.saveProgressCallback = saveProgressCallback;
    this.saveLayoutCallback = saveLayoutCallback;

    const presetLayout = layout.ids.length != 0;

    this.nodes = [];
    this.links = [];

    // add central node (title)
    const centreNode: Node = {
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
    // console.log("map:", this.mindMap.map.id);

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
      let id = toPathString(note.props.path);
      if (note.props.id) {
        id = note.props.id;
      }

      if (!nodeIDs.contains(id)) { // only add unique nodes
        let level = note.props.path.length - 1;
        let pathBuffer = note.props.path.slice(0, level);
        // console.log(toPathString(pathBuffer), "level:", level);
        while (pathBuffer.length > 0) {
          let targetId = toPathString(pathBuffer);
          let target = mindMap.notes.find((note) => toPathString(note.props.path) === targetId);
          if (!target?.props.study) {
            // console.log(`note not studyable id: ${targetId}`);
            level--;
          }
          pathBuffer.pop();
        }
        // console.log("level:", level);
        const node: Node = {
          id: id, 
          content: note.content, 
          // level: note.props.path.length - 1, 
          level: level, 
          study: note.props.study, 
          centre: false, 
        }
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

      let listIndex = note.props.listIndex;
      let parent = toPathString(note.props.path.slice(0, -1))
      if (note.props.listIndex > 1) {
        let chainIndex = chains.findIndex((group) => group.parent === parent);
        this.links.push({
          source: chains[chainIndex].nodes[listIndex - 2], // issue 2025-08-30a
          target: id
        });
      } else {
        this.links.push({
          source: parent, // issue 2025-08-30a
          target: id
        });
      }
    }

    // new StudySettingsModal(this.app, this.mindMap.map.title, (mode: string) => console.log("Mode:", mode));
    this.createGraph();
  }

  async createGraph() {
    const presetLayout = this.layout.ids.length != 0;
    console.log("MindMapView.createGraph(): preset layout:", presetLayout);

    this.simulation = d3.forceSimulation<Node>(this.nodes)
      .force('link', d3.forceLink<Node, Link>(this.links).id(d => d.id))
      .force('charge', d3.forceManyBody().strength(-100).theta(0.9).distanceMax(100))
      // .force("center", d3.forceCenter(0, 0).strength(0.1))
      // .force('x', d3.forceX().strength(1))
      // .force('y', d3.forceY().strength(1))
      .alpha(presetLayout ? 0.25 : 1)
      .alphaDecay(presetLayout ? DEFAULT_ALPHADECAY : 0.02)
      .on('tick', () => this.updateGraph());

    this.graphContainer.empty();

    const color = d3.scaleOrdinal(d3.schemeCategory10);

    // The force simulation mutates links and nodes, so create a copy
    // so that re-evaluating this cell produces the same result.
    const links = this.links.map(d => ({...d}));
    const nodes = this.nodes.map(d => ({...d}));

    // this.resize();
    // console.log("container size", this.graphContainer.clientWidth, this.graphContainer.clientHeight);
    this.svg = d3.select(this.graphContainer)
      .append("svg")
      // .attr("style", "max-width: 100%; height: 100%;")
      .attr("width", "100%")
      .attr("height", "100%")
      // .attr("viewBox", [-this.width / 2, -this.height / 2, this.width, this.height]);
      .attr("viewBox", [-this.width / 2, -this.height / 2, this.width, this.height])
      .call(d3.zoom<SVGSVGElement, unknown>()
        .extent([[-this.width / 2, -this.height / 2], [this.width / 2, this.height / 2]])
        .scaleExtent([0.1, 2])
        .on("zoom", (event) => this.zoomed(event)));
    
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
        .attr('fill', d => d.centre ? 'white' : (d.study ? colour(d.level) : COLOUR_STROKE))
        .attr('r', d => d.centre ? 10 : (d.study ? size(d.level) : 3))
        .attr("stroke", COLOUR_STROKE)
        .attr("stroke-width", 1)
      .call(d3.drag<SVGCircleElement, Node>()
          .on('start', (event, d) => {
              if (d.centre) return;
              if (!event.active) this.simulation.alphaTarget(0.5).restart();
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
  }

  updateGraph() {
    /* DYNAMIC UPDATING (BREAKS VIEW TRANFORMATIONS)
    // Update links
    // this.link = this.link.data(this.links, (d: Link) => `${d.source}-${d.target}`);
    // this.link.exit().remove();
    // this.link = this.link.enter().append('line')
    //   .attr('stroke', '#999')
    //   .attr('stroke-width', 2)
    //   .merge(this.link);

    // Update nodes
    // this.node = this.node.data(this.nodes, (d: Node) => d.id);
    // this.node.exit().remove();
    // this.node = this.node.enter().append('circle')
    //   .attr('nodeId', d => d.id)
    //   .attr("stroke", "#fff")
    //   .attr("stroke-width", 1)
    //   .attr('r', d => 5)
    //   .attr('fill', d => colour(d.level))
    //   .call(d3.drag<SVGCircleElement, Node>()
    //       .on('start', (event, d) => {
    //           if (!event.active) this.simulation.alphaTarget(0.3).restart();
    //           d.fx = d.x;
    //           d.fy = d.y;
    //       })
    //       .on('drag', (event, d) => {
    //           d.fx = event.x;
    //           d.fy = event.y;
    //       })
    //       .on('end', (event, d) => {
    //           if (!event.active) this.simulation.alphaTarget(0);
    //           d.fx = null;
    //           d.fy = null;
    //       })
    //   )
    //   .merge(this.node);

    // this.label = this.label.data(this.nodes, (d: Node) => d.id);
    // this.label.exit().remove();
    // this.label = this.label.enter().append("text")
    //   .text(d => d.content)
    //   .attr("text-anchor", "middle")
    //   .attr("dominant-baseline", "central")
    //   .attr("pointer-events", "none")
    //   .merge(this.label);
    */

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
    // console.log("alpha:", alpha);
    if (alpha <= MIN_ALPHA) {
      this.simulation.alphaDecay(DEFAULT_ALPHADECAY);
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