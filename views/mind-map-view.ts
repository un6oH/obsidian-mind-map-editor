import { App, ItemView, Modal, Setting, WorkspaceLeaf } from 'obsidian';
import { MapProperties, Note, NoteProperties, MindMap } from 'types';
import { toPathString } from 'helpers';
import * as d3 from 'd3';

export const VIEW_TYPE_MIND_MAP = 'mind-map-view';
const MIN_ALPHA = 0.001;

export interface Node extends d3.SimulationNodeDatum {
  id: string;
  content: string;
  level: number;
}

export interface Link extends d3.SimulationLinkDatum<Node> {
  source: string | Node;
  target: string | Node;
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

const colour = (level: number) => {
  const value = 255 / (level + 1);
  return `rgb(${value} ${value} ${value})`;
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

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    console.log("Mind map view created");
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
    // this.graphContainer.addEventListener('resize', this.resize);

    // new StudyManagerModal(this.app, "Mind Map", (mode: string) => console.log("Study started. mode:", mode)).open();
  }

  async onClose() {
    // Nothing to clean up.
    // this.graphContainer.removeEventListener('resize', this.resize);
  }

  createMindMap(mindMap: MindMap) {
    console.log("Mind map set");
    this.mindMap = mindMap;
    console.log(this.mindMap);

    this.nodes = [];

    // add central node (title)
    this.nodes.push({
      id: this.mindMap.map.id, 
      content: this.mindMap.map.title, 
      level: 0,
    });
    // console.log("map:", this.mindMap.map.id);

    // add notes
    const nodeIDs: string[] = [];
    for (let note of this.mindMap.notes) {
      let id = toPathString(note.props.path);
      if (note.props.id) {
        id = note.props.id;
      }

      if (!nodeIDs.contains(id)) { // only add unique nodes
        this.nodes.push({
          id: id, 
          content: note.content, 
          level: note.props.path.length - 1
        });
        nodeIDs.push(id);
      }

      this.links.push({
        source: toPathString(note.props.path.slice(0, -1)), 
        target: id
      });
    }

    // new StudySettingsModal(this.app, this.mindMap.map.title, (mode: string) => console.log("Mode:", mode));
    this.createGraph();
  }

  async createGraph() {
    this.simulation = d3.forceSimulation<Node>(this.nodes)
      .force('link', d3.forceLink<Node, Link>(this.links).id(d => d.id))
      .force('charge', d3.forceManyBody().strength(-100).theta(0.5))
      // .force("center", d3.forceCenter(0, 0))
      .force('x', d3.forceX())
      .force('y', d3.forceY())
      // .on;
      // .alphaTarget(0.001);
    this.simulation.on('tick', () => this.updateGraph());

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
        .scaleExtent([1, 10])
        .on("zoom", (event) => this.zoomed(event)));
    
    // this.link = this.svg.append('g').selectAll<SVGLineElement, Link>('line');
    // this.node = this.svg.append('g').selectAll<SVGCircleElement, Node>('circle');
    // this.label = this.svg.append('g').selectAll<SVGTextElement, Node>('text');
    this.link = this.svg.append('g')
        .attr('stroke', '#999')
        .attr('stroke-width', 2)
      .selectAll<SVGLineElement, Link>('line')
      .data(this.links)
      .join('line');
    this.node = this.svg.append('g')
        .attr("stroke", "#fff")
        .attr("stroke-width", 1)
      .selectAll<SVGCircleElement, Node>('circle')
      .data(this.nodes)
      .join('circle')
        .attr('nodeId', d => d.id)
        .attr('fill', d => colour(d.level))
        .attr('r', d => size(d.level))
      .call(d3.drag<SVGCircleElement, Node>()
          .on('start', (event, d) => {
              if (!event.active) this.simulation.alphaTarget(0.3).restart();
              d.fx = d.x;
              d.fy = d.y;
          })
          .on('drag', (event, d) => {
              d.fx = event.x;
              d.fy = event.y;
          })
          .on('end', (event, d) => {
              if (!event.active) this.simulation.alphaTarget(0);
              d.fx = null;
              d.fy = null;
          })
      )
    this.label = this.svg.append('g')
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .attr("pointer-events", "none")
      .selectAll<SVGTextElement, Node>('text')
      .data(this.nodes)
      .join('text')
        .text(d => d.content);
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
      console.log("MindMapView.updateGraph(): graph annealed");
      let ids: string[] = [];
      let xCoords: number[] = [];
      let yCoords: number[] = [];
      for (const node of this.node) {
        ids.push(node.getAttr('nodeId')!);
        xCoords.push(parseFloat(node.getAttr('cx')!));
        yCoords.push(parseFloat(node.getAttr('cy')!));
      }
      // console.log("this.node cx:", this.node.attr('cx', d => xCoords.push(d.x!)));
      // console.log("this.node cy:", this.node.attr('cy', d => yCoords.push(d.y!)));
      let nodePositions = new Array(this.nodes.length).fill(0).map((v, i) => [
        ids[i], xCoords[i], yCoords[i]
      ]);
      console.log("MindMapView.updateGraph(): node positions", nodePositions);
    }
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