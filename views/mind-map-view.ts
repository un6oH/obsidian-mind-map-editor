import { App, ItemView, Modal, Notice, SliderComponent, View, WorkspaceLeaf } from 'obsidian';
import { MapProperties, Note, NoteProperties, MindMap, MindMapLayout, createMindMap, NoteGroup } from 'types';
import { toPathString, colour, cardStateColours } from 'helpers';
import * as d3 from 'd3';
import { Card, fsrs, FSRS, generatorParameters, Grade, Grades, IPreview, Rating, RecordLog, show_diff_message, State } from 'ts-fsrs';

export const VIEW_TYPE_MIND_MAP = 'mind-map-view';
const MIN_ALPHA = 0.005;
const INITIAL_ALPHA = 0.5;
const INITIAL_ALPHADECAY = 0.16
const DRAG_ALPHA = MIN_ALPHA;
const DRAG_ALPHADECAY = 0.30;
const SCALE_EXTENT: [number, number] = [0.25, 4.0];
const HFACTOR = 2;

const STROKE_DASHARRAYS = [
  "4 2", 
  "4 2 2 2",
  "", 
  "4 2 2 2"
];

interface Node extends d3.SimulationNodeDatum {
  id: string;
  index: number;
  content: string;
  hidden: string;
  level: number;
  originIndex: number, 
  listIndex: number;
  study: boolean;
  centre: boolean;
  links: number[]; // indices of links to this node
  hasStudyableChildren: boolean;
}

interface Link extends d3.SimulationLinkDatum<Node> {
  index: number;
  source: string | Node;
  sourceIndex: number;
  originIndex: number;
  target: string | Node;
  targetIndex: number;
  level: number;
  card: Card | null;
  reviewed: boolean;
}

interface Chain {
  origin: string; // id of parent
  nodes: string[] // array of nodes in the chain
}

enum ViewMode {
  Navigate, 
  Arrange,
  Study, 
};

enum SearchType {
  DepthFirst, 
  BreadthFirst, 
}

interface Transform {
  x: number, 
  y: number, 
  k: number, 
}

export class MindMapView extends ItemView {
  mindMap: MindMap;
  nodes: Node[];
  links: Link[];
  interactableNodes: number[] = [];
  interactableLinks: number[] = [];
  
  fsrs: FSRS;
  now: Date;
  cardPreview: IPreview;

  graphContainer: Element;
  simulation: d3.Simulation<Node, Link>;
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  link: d3.Selection<SVGLineElement, Link, SVGGElement, unknown>;
  node: d3.Selection<SVGCircleElement, Node, SVGGElement, unknown>;
  label: d3.Selection<SVGTextElement, Node, SVGElement, unknown>;
  zoom: d3.ZoomBehavior<SVGSVGElement, unknown>;
  ratingInterfaceAnchor: HTMLElement;
  ratingInterface: HTMLElement;
  ratingButtons: Element[];

  width = 480;
  height = 360;
  marginTop = 20;
  marginRight = 20;
  marginBottom = 30;
  marginLeft = 40;
  stepsToAnneal: number;
  fontSize = 14;
  transform: Transform;

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

  createGraphButton: Element;
  createGraphButtonHandler: () => void;

  currentParent: number;
  nextNodeButton: Element;
  nextNodeButtonHandler: () => void;

  selectedNode: number | null;
  selectedLinkIndex: number | null;

  layout: MindMapLayout;
  saveProgressCallback: () => void;
  saveLayoutCallback: (layout: MindMapLayout) => void;

  sized = true;

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
    this.graphContainer = document.createElement('div');
    this.graphContainer.addClass('mind-map-view-graph-container');
    this.settingsContainer = document.createElement('div');
    this.settingsContainer.addClass('mind-map-view-settings-container');

    this.studyButton = document.createElement('button');
    this.studyButton.textContent = "Study";
    // this.studyButtonHandler = () => this.generateSchedule();
    this.studyButton.addEventListener('click', this.studyButtonHandler);

    this.searchTypeButton = document.createElement('button');
    this.searchTypeButton.textContent = "Search type: Depth-first";
    this.searchTypeButtonHandler = () => this.changeSearchType();
    this.searchTypeButton.addEventListener('click', this.searchTypeButtonHandler);

    this.viewModeButton = document.createElement('button');
    this.viewModeButton.textContent = `Mode: ${ViewMode[this.viewMode]}`;
    this.viewModeButtonHandler = () => this.changeViewMode();
    this.viewModeButton.addEventListener('click', this.viewModeButtonHandler);

    this.simulationButton = document.createElement('button');
    this.simulationButton.textContent = "Run simulation";
    this.simulationButtonHandler = () => this.toggleSimulation();
    this.simulationButton.addEventListener('click', this.simulationButtonHandler);

    this.createGraphButton = document.createElement('button');
    this.createGraphButton.textContent = "Create graph";
    this.createGraphButtonHandler = () => this.createGraph();
    this.createGraphButton.addEventListener('click', this.createGraphButtonHandler);

    this.nextNodeButton = document.createElement('button');
    this.nextNodeButton.textContent = "Go to next node";
    this.nextNodeButtonHandler = () => {
      this.changeViewMode(ViewMode.Study);
      this.goToNextNode()
    };
    this.nextNodeButton.addEventListener('click', this.nextNodeButtonHandler);

    const container = this.containerEl.children[1];
    container.addClass('mind-map-view-container');
    container.empty();
    container.appendChild(this.graphContainer);
    container.appendChild(this.settingsContainer);

    this.ratingInterfaceAnchor = document.createElement('div');
    this.ratingInterfaceAnchor.addClass('mind-map-rating-interface-anchor');
    this.ratingInterface = document.createElement('div');
    this.ratingInterface.addClass("mind-map-rating-interface");
    this.ratingButtons = [];
    for (let i = 0; i < 4; i++) {
      const button = document.createElement('button');
      button.addClass('mind-map-rating-interface-button');
      button.addClass(`mind-map-rating-interface-${["again", "hard", "good", "easy"][i]}`);
      button.textContent = ["Again", "Hard", "Good", "Easy"][i];
      button.addEventListener('click', () => this.handleRatingInput(Grades[i]));
      this.ratingButtons[i] = button;
      this.ratingInterface.appendChild(this.ratingButtons[i]);
    }
    this.ratingInterface.hide();
    this.ratingInterfaceAnchor.appendChild(this.ratingInterface);
    container.appendChild(this.ratingInterfaceAnchor);

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
      actionsContainer.appendChild(this.createGraphButton);
      actionsContainer.appendChild(this.nextNodeButton);
    }
  }

  async onClose() {
    this.studyButton.removeEventListener("click", this.studyButtonHandler);
    this.studyButton.remove();
    this.searchTypeButton.removeEventListener('click', this.searchTypeButtonHandler);
    this.searchTypeButton.remove();
    this.viewModeButton.removeEventListener('click', this.viewModeButtonHandler);
    this.viewModeButton.remove();
    this.simulationButton.removeEventListener('click', this.simulationButtonHandler);
    this.simulationButton.remove();
    this.createGraphButton.removeEventListener('click', this.createGraphButtonHandler);
    this.createGraphButton.remove();
    this.nextNodeButton.removeEventListener('click', this.nextNodeButtonHandler);
    this.nextNodeButton.remove();
  }

  onResize() {
    this.setZoom();
  }

  setZoom() {
    this.width = this.graphContainer.clientWidth;
    this.height = this.graphContainer.clientHeight;
    console.log("setZoom()", this.width, this.height);
    this.svg.attr("viewBox", [-this.width / 2, -this.height / 2, this.width, this.height]);
    this.zoom = this.zoom.extent([[-this.width / 2, -this.height / 2], [this.width / 2, this.height / 2]]);
    this.focusNodes();
  }

  async loadGraph(mindMap: MindMap, layout: MindMapLayout, saveProgressCallback: () => void, saveLayoutCallback: (layout: MindMapLayout) => void) {
    this.initialiseMindMap(mindMap, layout, saveProgressCallback, saveLayoutCallback);
    this.createGraph();
    console.log("loadGraph() sized:", this.sized);
    if (!this.sized) {
      this.setZoom();
    } else {
      this.sized = false;
    }
  }

  async initialiseMindMap(mindMap: MindMap, layout: MindMapLayout, saveProgressCallback: () => void, saveLayoutCallback: (layout: MindMapLayout) => void) {
    // console.log("initialiseMindMap() mindMap.notes:", mindMap.notes);
    this.mindMap = mindMap;
    this.layout = layout;
    this.saveProgressCallback = saveProgressCallback;
    this.saveLayoutCallback = saveLayoutCallback;
    this.fsrs = fsrs(this.mindMap.map.settings.studySettings);
    
    const presetLayout = layout.ids.length != 0;

    this.nodes = [];
    this.links = [];
    const originIds: string[] = [];

    // add central node (title)
    let centreNode = {} as Node;
    if (!mindMap.map.settings.separateHeadings) {
      centreNode = {
        id: this.mindMap.map.id, 
        index: 0, 
        content: this.mindMap.map.title, 
        hidden: "", 
        level: 0,
        originIndex: -1, 
        listIndex: 0, 
        study: false, 
        centre: true, 
        links: [], 
        hasStudyableChildren: false, 
        x: 0, 
        y: 0, 
        fx: 0, 
        fy: 0, 
      }
      this.nodes.push(centreNode);
      originIds.push("");
    }

    // preprocessing
    const groups: NoteGroup[] = [];
    const chains: Chain[] = [];
    let nodeIndex = 0;
    for (let note of this.mindMap.notes) {
      // add id groups
      if (note.id && this.mindMap.map.settings.crosslink) {
        const groupIndex = groups.findIndex((group) => group.id === note.id);
        if (groupIndex == -1) { // no matching id
          groups.push({
            content: note.content, 
            id: note.id, 
            indices: [nodeIndex], 
            levels: [], 
            ref: nodeIndex,
          });
        } else {
          groups[groupIndex].indices.push(nodeIndex);
          // make this note the reference if it has children or is before a note
          const level = note.props.path.length;
          const nextIndex = nodeIndex + 1;
          if (nextIndex < this.mindMap.notes.length) {
            const next = this.mindMap.notes[nextIndex];
            if (
              level < next.props.path.length ||
              (level == next.props.path.length && note.listIndex == next.listIndex - 1)
            ) groups[groupIndex].ref = nodeIndex;
          }
        }
      }
      nodeIndex++;

      // find chains
      const listIndex = note.listIndex;
      if (listIndex == 0) continue;

      let id = toPathString(note.props.path);
      let parent = toPathString(note.props.path.slice(0, -1));
      if (note.props.path.length == 1 && note.type === 'key word') { // top level note 
        if (this.mindMap.map.settings.separateHeadings) { // must have centre node
          new Notice("Error: Key words must be linked to a source node.");
          console.log("initialiseMindMap() Error: top level key word does not have centre node");
          return;
        } else {
          parent = centreNode.id;
        }
      }

      // add to chain array
      const chainIndex = chains.findIndex((chain) => chain.origin === parent);
      if (chainIndex != -1) {
        chains[chainIndex].nodes[listIndex - 1] = id; // assign chain
      } else {
        let i = chains.push({
          origin: parent, 
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
    nodeIndex = 0;
    let linkIndex = 0;
    const now = new Date();
    for (let note of this.mindMap.notes) {
      let nodeId: string;
      const path = note.props.path;
      
      // check crosslinks
      let newNode = true;
      if (note.id && this.mindMap.map.settings.crosslink) {
        const groupIndex = groups.findIndex((group) => group.id === note.id);
        const refIndex = groups[groupIndex].ref;
        const ref = this.mindMap.notes[refIndex];
        nodeId = toPathString(ref.props.path);
        newNode = refIndex == nodeIndex; // only make one new node per group
      } else {
        nodeId = toPathString(path);
        if (!this.nodes.every((node) => node.id !== nodeId)) newNode = false;
      }
      nodeIndex++;

      const level = path.length - 1;
      const study = note.props.study;
      const listIndex = note.listIndex;
      let source = path.length == 1 ? centreNode!.id : toPathString(note.props.path.slice(0, -1));
      const origin = source;
      if (listIndex > 1) { // node in a chain
        let chainIndex = chains.findIndex((group) => group.origin === source);
        source = chains[chainIndex].nodes[listIndex - 2];
      }

      if (newNode) { // only add unique nodes
        const {content, hidden} = formatContent(note.content);
        const node: Node = {
          id: nodeId, 
          index: this.nodes.length, 
          content: note.content, 
          hidden,
          level, 
          originIndex: -1, 
          listIndex, 
          study, 
          centre: false, 
          links: [], 
          hasStudyableChildren: false, 
        };
        if (presetLayout) {
          const index = layout.ids.findIndex((value) => value === nodeId);
          if (index != -1) {
            node.x = layout.xCoords[index];
            node.y = layout.yCoords[index];
          }
        }
        this.nodes.push(node);
        originIds.push(origin);
      }

      // separate headings
      if (mindMap.map.settings.separateHeadings && note.props.path.length == 1) continue;

      this.links.push({
        index: linkIndex, 
        source, 
        sourceIndex: 0, 
        originIndex: 0, 
        target: nodeId, 
        targetIndex: 0, 
        level: listIndex > 1 ? level : level - 1, 
        card: note.props.card, 
        reviewed: study ? note.props.card!.due > now : true, 
      });
      linkIndex++;
    }

    originIds.forEach((id, i) => {
      if (id) {
        const nodeIndex = this.nodes.findIndex((node) => node.id === id);
        if (nodeIndex == -1) {
          console.log("initialiseMindMap() node origin not found:", id, this.nodes.findIndex((node) => node.id === id));
          return;
        }
        this.nodes[i].originIndex = nodeIndex;
      }
    });

    

    for (let i = 0; i < this.links.length; i++) {
      const sourceId = this.links[i].source as string;
      const sourceNode = this.nodes.find(node => node.id === sourceId);
      const targetId = this.links[i].target as string;
      const targetNode = this.nodes.find(node => node.id === targetId);
      if (!sourceNode || !targetNode) {
        console.log("initialiseMindMap() node(s) not found:", sourceId, targetId);
        continue;
      }

      this.links[i].sourceIndex = sourceNode.index;
      this.links[i].targetIndex = targetNode.index;
      this.links[i].originIndex = targetNode.originIndex;
      this.nodes[sourceNode.index].links.push(i);
      if (this.links[i].card) this.nodes[sourceNode.index].hasStudyableChildren = true;
    }

    // console.log(this.nodes);
    // console.log(this.links);
    // console.log(originIds);
  }

  async createGraph() {
    const presetLayout = this.layout.ids.length != 0;
    console.log("MindMapView.createGraph(): preset layout:", presetLayout);

    this.graphContainer.empty();

    this.simulation = d3.forceSimulation<Node>(this.nodes)
      .force('link', d3.forceLink<Node, Link>(this.links).id(d => d.id).distance(0).strength(1))
      .force('charge', d3.forceManyBody().strength(-100).theta(0.9).distanceMax(100))
      .alpha(presetLayout ? 0 : INITIAL_ALPHA)
      .alphaDecay(INITIAL_ALPHADECAY)
      .alphaMin(MIN_ALPHA)
      .on('tick', () => this.updateGraph());

    this.width = this.sized ? this.graphContainer.clientWidth : 800;
    this.height = this.sized ? this.graphContainer.clientHeight : 600;
    this.svg = d3.select(this.graphContainer)
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%")
      // .attr("viewBox", [-this.width / 2, -this.height / 2, this.width, this.height])
      .attr("viewBox", [-this.width / 2, -this.height / 2, this.width, this.height])
      .on('click', () => this.handleBackgroundClick());
    
    this.link = this.svg.append('g')
      .selectAll<SVGLineElement, Link>('line')
      .data(this.links)
      .join('line')
        .attr('id', d => d.index)
        // .attr('stroke', d => d.card ? cardStateColours[d.card.state] : (d.level == -1 ? "gray" : colour(d.level)))
        // .attr('stroke', d => d.level == -1 ? "gray" : colour(d.level))
        .attr('stroke', d => linkStroke(this.viewMode, d))
        // .attr('stroke-dasharray', d => d.card ? STROKE_DASHARRAYS[d.card.state] : "")
        .attr('stroke-dasharray', d => linkStrokeDasharray(this.viewMode, d))
        .attr('stroke-width', 1);

    this.node = this.svg.append('g')
      .selectAll<SVGCircleElement, Node>('circle')
      .data(this.nodes)
      .join('circle')
        .attr('id', d => d.id)
        .attr('nodeIndex', d => d.index)
        .attr('fill', d => nodeFill(this.viewMode, d, this.links)) // to do: white when before review, filled in when reviewed
        // .attr('fill', d => d.centre ? 'gray' : d.study ? 'white' : colour(d.level)) // to do: white when before review, filled in when reviewed
        // .attr('fill', d => d.centre ? 'gray' : d.study ? 'white' : colour(d.level)) // to do: white when before review, filled in when reviewed
        // .attr('r', d => d.centre ? 10 : (d.hasStudyableChildren ? size(d.level) : 5))
        .attr('r', d => nodeRadius(d))
        .attr("stroke", "white")
        .attr("stroke-width", 0)
      .on('click', (event: any, node: Node) => {
        event.stopPropagation();
        this.handleNodeClick(event, node);
      })
      .call(d3.drag<SVGCircleElement, Node>()
        .on('start', (event, d) => {
            if (this.viewMode != ViewMode.Arrange) return;
            if (d.centre) return;
            if (!event.active) this.simulation.alpha(DRAG_ALPHA).alphaDecay(0).restart();
            console.log("drag start 1", d.fx);
            d.fx = d.x ? d.x : null;
            d.fy = d.y ? d.y : null;
            console.log("drag start 2", d.fx);
        })
        .on('drag', (event, d) => {
            if (this.viewMode != ViewMode.Arrange) return;
            if (d.centre) return;
            const k = this.transform.k;
            d.fx = d.x! + event.dx / k / HFACTOR;
            d.fy = d.y! + event.dy / k;
            // console.log("drag", d.fx);
        })
        .on('end', (event, d) => {
            console.log("drag end");
            if (!event.active) this.simulation.alphaTarget(0).alphaDecay(DRAG_ALPHADECAY);
            d.fx = d.centre ? 0 : null;
            d.fy = d.centre ? 0 : null;
        })
      );

    this.label = this.svg.append('g')
      .selectAll<SVGTextElement, Node>('text')
      .data(this.nodes)
      .join('text')
        .text(d => d.content)
        .attr("id", d => d.index)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .attr("pointer-events", "none")
        .attr("font-size", "12px")
        .attr("class", "mindmap-node-label");

    this.zoom = d3.zoom<SVGSVGElement, unknown>()
      .extent([[-this.width / 2, -this.height / 2], [this.width / 2, this.height / 2]])
      .scaleExtent(SCALE_EXTENT)
      .on("zoom", (event) => this.zoomed(event));
    this.svg.call(this.zoom);
  }

  handleBackgroundClick() {
    if (this.viewMode != ViewMode.Study) {
      this.focusNodes();
    }
  }

  handleNodeClick(event: any, node: Node) {
    switch (this.viewMode) {
      case ViewMode.Arrange: 
        break;
      case ViewMode.Navigate:
        this.focusNodes(node, 2, 2);
        break;
      case ViewMode.Study:
        if (!this.selectedNode) {
          console.log("handleNodeClick() Study");
          if (!this.interactableNodes.contains(node.index)) {
            console.log("studyNodeInteract() node not interactable");
            break;
          }
          this.studyNodeInteract(event, node);
        }
        break;
    }
  }

  studyNodeInteract(event: any, node: Node) {
    this.now = new Date();
    const linkIndex = this.interactableLinks.find((i) => this.links[i].targetIndex == node.index);
    if (!linkIndex) {
      console.log("studyNodeInteract() error: link does not exist.");
      return;
    }
    const link = this.links[linkIndex];
    const card = link.card;
    if (!card) {
      console.log("studyNodeInteract() error: card does not exist.");
      return;
    }
    this.selectedLinkIndex = linkIndex;
    this.cardPreview = this.fsrs.repeat(card, this.now);
    this.selectedNode = node.index;
    this.interactableNodes.remove(node.index);
    this.interactableLinks.remove(linkIndex);

    const nodeSvg = this.node.filter((_, i) => i == node.index);
    nodeSvg.attr('stroke-width', 0);
    const label = this.label.filter((_, i) => i == node.index);
    label.text(d => d.content);
    this.showRatingInterface(event, node);
  }

  showRatingInterface(event: any, node: Node) {
    const x = node.x! * HFACTOR;
    const y = node.y!;
    this.ratingInterface.show();
    this.ratingInterfaceAnchor.style.left = (this.width / 2 + (x * this.transform.k) + this.transform.x).toString() + "px";
    this.ratingInterfaceAnchor.style.top = (this.height / 2 + (y * this.transform.k) + this.transform.y).toString() + "px";
    // this.ratingInterfaceAnchor.style.left = event.clientX.toString() + "px";
    // this.ratingInterfaceAnchor.style.top = event.clientY.toString() + "px";
    let i = 0;
    for (const item of this.cardPreview) {
      const card = item.card;
      const diff = show_diff_message(card.due, this.now, true, [" min", " d"]);
      this.ratingButtons[i].textContent = `${["Again", "Hard", "Good", "Easy"][i]} (${diff})`;
      i++;
    }
  }

  deselect() {
    this.selectedNode = null;
    this.selectedLinkIndex = null;
    this.ratingInterface.hide();
  }

  handleRatingInput(grade: Grade) {
    this.links[this.selectedLinkIndex!].card = this.cardPreview[grade].card;
    console.log(`handleRatingInput() ${this.links[this.selectedLinkIndex!].source} -> ${this.links[this.selectedLinkIndex!].target}; new card:`, this.links[this.selectedLinkIndex!].card);
    this.deselect();
    if (this.interactableNodes.length == 0) this.goToNextNode();
  }

  updateGraph() {
    console.log("updateGraph()");
    if (this.simulationRunning) {
      this.simulation.alphaTarget(INITIAL_ALPHA);
    }
    // Update positions on each tick
    this.simulation.nodes(this.nodes);
    (this.simulation.force('link') as d3.ForceLink<Node, Link>).links(this.links);

    this.link
      .attr('x1', d => (d.source as Node).x! * HFACTOR)
      .attr('y1', d => (d.source as Node).y!)
      .attr('x2', d => (d.target as Node).x! * HFACTOR)
      .attr('y2', d => (d.target as Node).y!);

    this.node
      .attr('cx', d => d.x! * HFACTOR)
      .attr('cy', d => d.y!);

    this.label
      .attr('x', d => d.x! * HFACTOR)
      .attr('y', d => d.y!);
    
    let alpha = this.simulation.alpha();
    if (alpha < MIN_ALPHA) {
      // console.log("MindMapView.updateGraph(): graph settled in", this.stepsToAnneal, "steps");
      // this.stepsToAnneal = 0;
      this.saveLayout();
    } else {
      // this.stepsToAnneal++;
    }
  }

  saveLayout() {
    let id: string;
    let x: number;
    let y: number;
    const layout = {} as MindMapLayout;
    layout.path = this.layout.path;
    layout.ids = [];
    layout.xCoords = [];
    layout.yCoords = [];
    for (const node of this.nodes) {
      id = node.id;
      x = Math.round(node.x!);
      y = Math.round(node.y!);
      
      layout.ids.push(id);
      layout.xCoords.push(x);
      layout.yCoords.push(y);
    }
    this.layout = layout;

    console.log("saveLayout()", this.layout);
    this.saveLayoutCallback(layout);
  }

  zoomed(event: d3.D3ZoomEvent<SVGSVGElement, unknown>) {
    this.transform = {
      x: event.transform.x, 
      y: event.transform.y, 
      k: event.transform.k, 
    }

    const transform = event.transform.toString();
    const x = event.transform.x;
    const y = event.transform.y;
    const k = event.transform.k;

    this.node
      .attr("transform", transform)
      .attr('r', d => nodeRadius(d) / k)
      .attr("stroke-width", (d, i) => this.interactableNodes.contains(i) ? 2 / k : 0);
    this.link
      .attr("transform", transform)
      .attr("stroke-width", 2 / k);
    const fontSize = this.fontSize / k;
    this.label
      .attr("transform", transform)
      .attr("font-size", `${fontSize}px`);

    if (this.selectedNode) {
      const nodePosition = [this.nodes[this.selectedNode].x!, this.nodes[this.selectedNode].y!];
      this.ratingInterfaceAnchor.style.left = (this.width / 2 + (nodePosition[0] * 2 * k + x)).toString() + "px";
      this.ratingInterfaceAnchor.style.top = (this.height / 2 + nodePosition[1] * k + y).toString() + "px";
    }
  }

  getNodes(node: Node, backDepth: number, forwardDepth: number): Node[] {
    const nodes: Node[] = [];
    let parentNodes: Node[] = [node];
    let childNodes: Node[] = [node];

    let startIndex = 0;
    let newIndex = 0;
    for (let d = 0; d < backDepth; d++) {
      newIndex = parentNodes.length;
      parentNodes.slice(startIndex).forEach((node) => {
        const links = this.links.filter((link) => (link.target as Node).id === node.id);
        parentNodes.push(...links.map((link) => link.source as Node));
      });
      startIndex = newIndex;
    }
    childNodes.push(node);
    startIndex = 0;
    for (let i = 0; i < forwardDepth; i++) {
      newIndex = childNodes.length;
      childNodes.slice(startIndex).forEach((node) => {
        const links = this.links.filter((link) => (link.source as Node).id === node.id);
        childNodes.push(...links.map((link) => link.target as Node));
      });
      startIndex = newIndex;
    }
    parentNodes.forEach((test) => {
      if (nodes.findIndex((node) => node.id === test.id) == -1) nodes.push(test);
    });
    childNodes.forEach((test) => {
      if (nodes.findIndex((node) => node.id === test.id) == -1) nodes.push(test);
    });

    return nodes;
  }

  getNodeIndices(index: number, backDepth: number, forwardDepth: number): number[] {
    let indices: number[] = [];
    let parentIndices: number[] = [index];
    let childIndices: number[] = [index];

    let startIndex = 0;
    let newIndex = 0;
    for (let d = 0; d < backDepth; d++) {
      newIndex = parentIndices.length;
      parentIndices.slice(startIndex).forEach((i) => {
        const links = this.links.filter((link) => link.targetIndex == i/*  || this.nodes[link.sourceIndex].originIndex == this.nodes[link.targetIndex].originIndex */);
        parentIndices.push(...links.map((link) => link.sourceIndex));
      });
      startIndex = newIndex;
    }
    startIndex = 0;
    for (let i = 0; i < forwardDepth; i++) {
      newIndex = childIndices.length;
      childIndices.slice(startIndex).forEach((i) => {
        const links = this.links.filter((link) => link.sourceIndex == i || this.nodes[link.targetIndex].originIndex == i);
        childIndices.push(...links.map((link) => link.targetIndex));
      });
      startIndex = newIndex;
    }
    parentIndices.forEach((i) => {
      if (!indices.contains(i)) indices.push(i);
    });
    childIndices.forEach((i) => {
      if (!indices.contains(i)) indices.push(i);
    });
    // console.log("getNodeIndices() indices:", indices);
    return indices;
  }

  focusNodes(node?: Node, backDepth?: number, forwardDepth?: number) {
    let nodes: Node[] = [];
    let indices: number[] = [];
    backDepth = backDepth ? backDepth : 0;
    forwardDepth = forwardDepth ? forwardDepth : (backDepth ? backDepth : 0);
    if (node) {
      indices = this.getNodeIndices(node.index, backDepth, forwardDepth);
      nodes = this.nodes.filter(node => indices.contains(node.index));
    

      this.node.attr('opacity', d => indices.contains(d.index) ? "100%" : "50%");
      this.link.attr('opacity', d => {
        const containsTarget = indices.contains(d.targetIndex);
        const containsSource = indices.contains(d.sourceIndex);
        return containsTarget && containsSource ? "100%" : "50%";
      });
      this.label.attr('opacity', d => indices.contains(d.index) ? "100%" : "0%");
    } else {
      this.node.attr('opacity', "100%",);
      this.link.attr('opacity', "100%");
      this.label.attr('opacity', "100%");
      nodes = this.nodes;
    }

    const xCoords = nodes.map((node) => node.x! * HFACTOR);
    const yCoords = nodes.map((node) => node.y!);
    let minX = Math.min(...xCoords);
    let maxX = Math.max(...xCoords);
    let minY = Math.min(...yCoords);
    let maxY = Math.max(...yCoords);
    const frameCentreX = (minX + maxX) * 0.5;
    const frameCentreY = (minY + maxY) * 0.5;
    const frameWidth = Math.max(maxX - minX, 1);
    const frameHeight = Math.max(maxY - minY, 1);
    const scaleF = 0.833 * Math.min(this.width / frameWidth, this.height / frameHeight);
    const transform = d3.zoomIdentity
        .scale(Math.min(Math.max(scaleF, SCALE_EXTENT[0]), SCALE_EXTENT[1]))
        .translate(-frameCentreX, -frameCentreY);
    // console.log("focusNodes")
    this.svg.transition().duration(500).call(
      this.zoom.transform,
      transform, 
    );
  }

  changeViewMode(mode?: ViewMode) {
    let buttonText = "";
    if (mode) {
      this.viewMode = mode;
    } else {
      switch(this.viewMode) { // cycle through options
        case ViewMode.Arrange: 
          this.viewMode = ViewMode.Navigate; 
          break;
        case ViewMode.Navigate: 
          this.viewMode = ViewMode.Study; 
          this.goToNextNode();
          break;
        case ViewMode.Study: 
          this.viewMode = ViewMode.Arrange; 
          break;
      }
    }
    this.viewModeButton.textContent = [
      "Mode: Navigate", 
      "Mode: Arrange", 
      "Mode: Study"
    ][this.viewMode];

    if (this.viewMode != ViewMode.Study) {
      this.interactableNodes = [];
      this.interactableLinks = [];
      this.deselect();
      this.focusNodes();
    }

    this.updateGraphics();
  }

  updateGraphics() {
    this.node.attr('stroke-width', 0);
    this.link.attr('stroke', d => linkStroke(this.viewMode, d));
    this.link.attr('stroke-dasharray', d => linkStrokeDasharray(this.viewMode, d));
    if (this.viewMode == ViewMode.Study) {
      const hiddenNodes = new Array(this.nodes.length).fill(false);
      this.links.forEach(link => {
        if (!link.reviewed) hiddenNodes[link.targetIndex] = true;
      });
      this.label.text((d, i) => hiddenNodes[i] ? d.hidden : d.content);
    } else {
      this.label.text(d => d.content);
    }
  }

  toggleSimulation() {
    this.simulationRunning = !this.simulationRunning;
    if (this.simulationRunning) {
      this.simulationButton.textContent = "Stop simulation";
      this.simulation.alpha(INITIAL_ALPHA).restart();
    } else {
      this.simulationButton.textContent = "Run simulation";
      this.simulation.alphaTarget(0).alphaDecay(INITIAL_ALPHADECAY);
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

  setInteractable(parent: number) {
    const indices = this.getNodeIndices(parent, 0, 1);
    indices.shift();
    const links = this.links.filter(link => indices.contains(link.targetIndex));
    this.interactableNodes = links.filter(link => !link.reviewed).map(link => link.targetIndex);
    this.interactableLinks = links.map(link => link.index);
    const interactable = this.node.filter((d, i) => this.interactableNodes.contains(i));
    interactable.attr('stroke-width', 2 / this.transform.k);
  }

  updateDue() {
    this.now = new Date();
    this.links.forEach((link, i) => {
      if (!link.card) return;
      this.links[i].reviewed = link.card.due > this.now;
    });
    this.updateGraphics();
  }

  goToNextNode() {
    this.updateDue();
    const nodes = this.nodes.filter((node) => {
      if (!node.hasStudyableChildren) return false;
      // all links with this node as the origin
      const links = this.links
        .filter(link => this.nodes[link.targetIndex].originIndex == node.index);
      for (let link of links) {
        if (!link.reviewed) return true;
      }
    });
    if (nodes.length == 0) {
      new Notice("No notes due", 0);
      console.log("no notes due");
      this.selectedNode = null;
      this.interactableNodes = [];
      this.interactableLinks = [];
      return;
    }
    nodes.sort((a, b) => 
      a.level < b.level ?
        -1 :
        a.level == b.level ?
          a.listIndex - b.listIndex :
          1
    );
    const index = nodes[0].index;
    this.currentParent = index;
    this.setInteractable(index);
    this.focusNodes(this.nodes[index], 2, 2);
    console.log("goToNextNode() node:", this.nodes[index].content);
  }
}

function nodeRadius (node: Node) { 
  if (node.centre) {
    return 10;
  } else {
    return 6 + 6 / (node.level + 1);
  }
};

function nodeFill(mode: ViewMode, node: Node, linkArray: Link[]): string {
  // if (mode == ViewMode.Study) {
  //   if (!node.hasStudyableChildren) {
  //     if (node.centre) return "grey";
  //     return colour(node.level);
  //   } else {
  //     const links = node.links.map(i => linkArray[i]);
  //     let lowestState = Math.min(...links.filter(link => link.card).map(link => link.card!.state));
  //     return cardStateColours[lowestState];
  //   }
  // } else {
  //   return node.centre ? 'white' : colour(node.level);
  // }
  return node.centre ? 'white' : colour(node.level);
}

function linkStroke(mode: ViewMode, link: Link): string {
  const base = link.level == -1 ? "gray" : colour(link.level);
  // if (mode == ViewMode.Study) {
  //   if (link.card) return cardStateColours[link.card.state];
  // }
  return base;
}

function linkStrokeDasharray(mode: ViewMode, link: Link): string {
  if (mode == ViewMode.Study) {
    if (link.card) {
      if (!link.reviewed) return "4 2"
    }
  }
  return "";
}

function formatContent(text: string): { content: string, hidden: string } {
  return {
    content: "", 
    hidden: ""
  };
}

function textWrap(docClass: string, text: string, aspect: number) { // aspect = width / height
  
}