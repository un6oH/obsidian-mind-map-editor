import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import { MindMap, MindMapLayout, NoteGroup } from 'types';
import { colour, formatContent } from 'helpers';
import * as d3 from 'd3';
import { Card, fsrs, FSRS, Grade, Grades, IPreview, Rating, show_diff_message } from 'ts-fsrs';

export const VIEW_TYPE_MIND_MAP = 'mind-map-view';
const MIN_ALPHA = 0.005;
const INITIAL_ALPHA = 0.5;
const INITIAL_ALPHADECAY = 0.05;
const DRAG_ALPHA = INITIAL_ALPHA;
const DRAG_ALPHADECAY = 0.02;
const SCALE_EXTENT: [number, number] = [0.25, 4.0];
const xStretch = 1.5;

const STROKE_DASHARRAYS = [
  "4 2", 
  "4 2 2 2",
  "", 
  "4 2 2 2"
];

interface Node extends d3.SimulationNodeDatum {
  id: string; // path in root\parent\self format 
  index: number; // 0-based index assigned by forceS
  content: Element; // display for viewing or revealed answer
  hidden: Element; // display for hidden answer
  collideRadius: number; // radius to allow space for text
  level: number; // level in list hierarchy. 0 if root
  // cardOriginIndex: number, // deprecated
  listNumber: number; // number in ordered list. 0 if unordered
  // study: boolean; // deprecated
  // centre: boolean; // deprecated
  // links: number[]; // deprecated
  linksTo: number[]; // indices of links to this node
  linksFrom: number[]; // indices of links from this node
  // hasStudyableChildren: boolean; // deprecated
}

interface Link extends d3.SimulationLinkDatum<Node> {
  index: number;
  source: string | Node;
  // sourceIndex: number; // deprecated. use source.index
  target: string | Node;
  // targetIndex: number; // deprecated. use target.index
  level: number; // level in list hierarchy. 0 if root
  parent: string | Node; // reference to parent note
  card: Card | null;
  reviewed: boolean; // true if no card
}

interface Chain {
  parent: string; // id of parent
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
  // mind map
  mindMap: MindMap = {} as MindMap;
  nodes: Node[] = [];
  links: Link[] = [];
  selectedParent: Node | null = null;
  interactableNodes: Node[] = [];
  interactableLinks: Link[] = [];
  
  // spaced repetition
  fsrs: FSRS = {} as FSRS;
  now: Date = new Date();
  cardPreview: IPreview = {} as IPreview;
  selectedNode: Node | null = null;
  selectedLink: Link | null = null;

  // force directed graph
  graphContainer: Element = {} as Element;
  simulation: d3.Simulation<Node, Link> = {} as d3.Simulation<Node, Link>;
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined> = {} as d3.Selection<SVGSVGElement, unknown, null, undefined>;
  g: d3.Selection<SVGGElement, unknown, null, undefined> = {} as d3.Selection<SVGGElement, unknown, null, undefined>;
  link: d3.Selection<SVGLineElement, Link, SVGGElement, unknown> = {} as d3.Selection<SVGLineElement, Link, SVGGElement, unknown>;
  node: d3.Selection<SVGCircleElement, Node, SVGGElement, unknown> = {} as d3.Selection<SVGCircleElement, Node, SVGGElement, unknown>;
  label: d3.Selection<SVGTextElement, Node, SVGElement, unknown> = {} as d3.Selection<SVGTextElement, Node, SVGElement, unknown>;
  zoom: d3.ZoomBehavior<SVGSVGElement, unknown> = {} as d3.ZoomBehavior<SVGSVGElement, unknown>;
  
  // graph interaction
  ratingInterfaceAnchor: HTMLElement = {} as HTMLElement;
  ratingInterface: HTMLElement = {} as HTMLElement;
  ratingInterfaceOffset = 0; // amount to lower interface to show the content
  ratingButtons: Element[] = [];
  labels: HTMLElement[] = [];
  labelContainer: HTMLElement = {} as HTMLElement;
  labelAnchors: HTMLElement[] = [];

  // styling
  width = 480;
  height = 360;
  minFontSize = 14;
  maxFontScale = 1.5;
  transform: Transform = {
    x: 0,
    y: 0, 
    k: 1, 
  };

  studyButton: Element = {} as Element;
  studyButtonHandler: () => void = () => {};

  searchType = SearchType.DepthFirst;
  searchTypeButton: Element = {} as Element;
  searchTypeButtonHandler = () => this.changeSearchType();

  viewModeButton: Element = {} as Element;
  viewMode = ViewMode.Navigate;
  viewModeButtonHandler = () => this.changeViewMode();

  simulationButton: Element = {} as Element;
  simulationRunning = false;
  simulationButtonHandler = () => this.toggleSimulation();

  createGraphButton: Element = {} as Element;
  createGraphButtonHandler = () => this.createGraph();

  nextNodeButton: Element = {} as Element;
  nextNodeButtonHandler = () => {};

  showLabels = true;
  toggleLabelButton: Element = {} as Element;
  toggleLabelButtonHandler = () => this.toggleLabels();


  layout: MindMapLayout = {} as MindMapLayout;
  saveProgressCallback = () => {};
  saveLayoutCallback = (layout: MindMapLayout) => {};

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

    this.studyButton = document.createElement('button');
    this.studyButton.textContent = "Study";
    this.studyButton.addEventListener('click', this.studyButtonHandler);

    this.searchTypeButton = document.createElement('button');
    this.searchTypeButton.textContent = "Search type: Depth-first";
    this.searchTypeButton.addEventListener('click', this.searchTypeButtonHandler);

    this.viewModeButton = document.createElement('button');
    this.viewModeButton.textContent = `Mode: ${ViewMode[this.viewMode]}`;
    this.viewModeButton.addEventListener('click', this.viewModeButtonHandler);

    this.simulationButton = document.createElement('button');
    this.simulationButton.textContent = "Run simulation";
    this.simulationButton.addEventListener('click', this.simulationButtonHandler);

    this.createGraphButton = document.createElement('button');
    this.createGraphButton.textContent = "Create graph";
    this.createGraphButton.addEventListener('click', this.createGraphButtonHandler);

    this.nextNodeButton = document.createElement('button');
    this.nextNodeButton.textContent = "Go to next node";
    this.nextNodeButtonHandler = () => {
      this.changeViewMode(ViewMode.Study);
      this.goToNextNode()
    };
    this.nextNodeButton.addEventListener('click', this.nextNodeButtonHandler);

    this.toggleLabelButton = document.createElement('button');
    this.toggleLabelButton.textContent = "Hide labels";
    this.toggleLabelButton.addEventListener('click', this.toggleLabelButtonHandler);

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
    // add to graph container in createGraph()

    this.labelContainer = document.createElement('div');
    this.labelContainer.inert = true;
    this.labelContainer.addClass("mind-map-label-container");
    // add to graph container in createGraph()

    const container = this.containerEl.children[1];
    container.addClass('mind-map-view-container');
    container.empty();
    container.appendChild(this.graphContainer);
    
    // (container as HTMLElement).focus();

    const header = this.containerEl.querySelector(".view-header") as HTMLElement | null;
    if (header) {
      const actionsContainer =
        header.querySelector(".view-actions") ||
        header.querySelector(".view-header-actions") ||
        header;
      // actionsContainer.appendChild(this.studyButton);
      actionsContainer.appendChild(this.searchTypeButton);
      actionsContainer.appendChild(this.viewModeButton);
      actionsContainer.appendChild(this.simulationButton);
      actionsContainer.appendChild(this.createGraphButton);
      // actionsContainer.appendChild(this.nextNodeButton);
      actionsContainer.appendChild(this.toggleLabelButton);
    }

    // this.containerEl.addEventListener('keypress', this.keyPressHandler);
    // this.containerEl.setAttribute('tabindex', '0');
    // this.containerEl.focus();
    container.setAttribute('tabindex', '0');
    (container as HTMLElement).focus();
    this.registerDomEvent(container as HTMLElement, 'keypress', (ev: KeyboardEvent) => this.keyPressHandler(ev));
    this.registerDomEvent(window, 'keypress', (ev: KeyboardEvent) => this.keyPressHandler(ev));
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
    this.simulation.stop();
  }

  keyPressHandler(event: KeyboardEvent) {
    console.log("keyPressHandler()");
    switch (event.key) {
      case '[':
        this.minFontSize = Math.max(6, this.minFontSize - 2);
        this.nodes.forEach(node => {
          this.labelAnchors[node.index].style.fontSize = fontSize(this.minFontSize * this.transform.k, this.minFontSize * this.maxFontScale * this.transform.k, node.level);
        });
        console.log("minFontSize:", this.minFontSize);
        break;
      case ']':
        this.minFontSize += 2;
        this.nodes.forEach(node => this.labelAnchors[node.index].style.fontSize = fontSize(this.minFontSize * this.transform.k, this.minFontSize * this.maxFontScale * this.transform.k, node.level));
        console.log("minFontSize:", this.minFontSize);
        break;
    }
    
    if (this.selectedNode) {
      switch (event.key) {
        case '1':
          this.handleRatingInput(Rating.Again);
          break;
        case '2':
          this.handleRatingInput(Rating.Hard);
          break;
        case ' ':
        case '3':
          this.handleRatingInput(Rating.Good);
          break;
        case '4':
          this.handleRatingInput(Rating.Easy);
          break;
      }
    }
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
    this.loadMindMap(mindMap, layout, saveProgressCallback, saveLayoutCallback);
    this.createGraph();
    console.log("loadGraph() sized:", this.sized);
    if (!this.sized) {
      this.setZoom();
    } else {
      this.sized = false;
    }
  }

  async loadMindMap(mindMap: MindMap, layout: MindMapLayout, saveProgressCallback: () => void, saveLayoutCallback: (layout: MindMapLayout) => void) {
    console.log("loadMindMap() mindMap.notes:", mindMap.notes);
    this.mindMap = mindMap;
    this.layout = layout;
    this.saveProgressCallback = saveProgressCallback;
    this.saveLayoutCallback = saveLayoutCallback;
    this.fsrs = fsrs(this.mindMap.map.studySettings);
    
    const presetLayout = layout.ids.length != 0;

    this.nodes = [];
    this.links = [];
    const originIds: string[] = [];

    // add central node (title)
    let centreNode = {} as Node;
    if (!mindMap.map.separateHeadings) {
      let content = document.createElement('span');
      content.textContent = this.mindMap.map.title;
      // console.log("centre node content:", content);
      content.addClass('mind-map-label-title');
      centreNode = {
        id: this.mindMap.map.title, 
        index: 0, 
        content, 
        hidden: content, 
        collideRadius: Math.sqrt(this.mindMap.map.title.length), 
        level: 0,
        listNumber: 0, 
        linksTo: [], 
        linksFrom: [], 
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
      // if the note has a specified id
      if (note.id && this.mindMap.map.crosslink) {
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
          const level = mindMap.tree[nodeIndex].length - 1;
          const nextIndex = nodeIndex + 1;
          if (nextIndex < this.mindMap.notes.length) {
            const levelOfNext = mindMap.tree[nextIndex].length - 1;
            if (level < levelOfNext) groups[groupIndex].ref = nodeIndex;
          }
        }
      }

      // find chains
      const listNumber = note.listNumber;
      if (listNumber == 0) {
        nodeIndex++;
        continue;
      }

      // let id = toPathString(note.props.path);
      let path = mindMap.tree[nodeIndex];
      let id = path.join('-');
      let parent = path.slice(0, -1).join('-');
      if (path.length == 1) { // primary node that can be studied
        if (mindMap.map.separateHeadings && note.card) { // must have centre node
          new Notice("Error: Studyable notes must have a parent node.");
          console.log("loadMindMap() Error: key word does not have a parent node content:", note.content, "path:", path);
          return;
        } else {
          parent = centreNode.id;
        }
      }

      // add to chain array
      // console.log("loadMindMap() parent:", parent, id);
      const chainIndex = chains.findIndex((chain) => chain.parent === parent);
      if (chainIndex != -1) {
        chains[chainIndex].nodes[listNumber - 1] = id; // assign chain
      } else {
        let i = chains.push({
          parent: parent, 
          nodes: []
        });
        chains[i - 1].nodes[listNumber - 1] = id;
      }

      nodeIndex++;
    }

    // verify chains
    console.log("loadMindMap() chains:", chains)
    for (let chain of chains) {
      for (let i = 0; i < chain.nodes.length; i++) {
        if (chain.nodes[i] === undefined) {
          console.log("loadMindMap() Error: chain entry missing.", chain);
          return;
        }
      }
    }

    // populate nodes and links
    nodeIndex = 0;
    let linkIndex = 0;
    const now = new Date();
    for (let note of this.mindMap.notes) {
      // console.log("loadMindMap() note", note);
      let nodeId: string;
      const path = mindMap.tree[nodeIndex];
      
      // check crosslinks
      let newNode = true;
      if (note.id && this.mindMap.map.crosslink) {
        const groupIndex = groups.findIndex((group) => group.id === note.id);
        const refIndex = groups[groupIndex].ref;
        // const ref = this.mindMap.notes[refIndex];
        nodeId = mindMap.tree[refIndex].join('-');
        newNode = refIndex == nodeIndex; // only make one new node per group
      } else {
        nodeId = path.join('-');
        // check for duplicates
        if (!this.nodes.every((node) => node.id !== nodeId)) newNode = false;
      }
      nodeIndex++;

      const level = path.length - 1;
      const study = note.card;
      const listNumber = note.listNumber;
      let source = path.length == 1 ? centreNode!.id : path.slice(0, -1).join('-');
      const origin = source;
      if (listNumber > 1) { // node in a chain
        let chainIndex = chains.findIndex((group) => group.parent === source);
        source = chains[chainIndex].nodes[listNumber - 2];
      }

      // console.log("loadMindMap()", newNode);
      if (newNode) { // only add unique nodes
        const {content, hidden} = formatContent(document, note.content, this.viewImage);
        // console.log(note.content, content, hidden);
        const node: Node = {
          id: nodeId, 
          index: this.nodes.length, 
          content, 
          hidden,
          collideRadius: collideRadius(note.content), 
          level, 
          listNumber, 
          linksTo: [], 
          linksFrom: [], 
        };
        if (presetLayout) {
          const index = layout.ids.findIndex((value) => value === nodeId);
          if (index != -1) {
            node.x = layout.xCoords[index];
            node.y = layout.yCoords[index];
          }
        }
        // console.log("loadMindMap() new node", node);
        this.nodes.push(node);
        originIds.push(origin);
      }

      // separate headings
      if (mindMap.map.separateHeadings && path.length == 1) continue;

      this.links.push({
        index: linkIndex, 
        source, 
        // sourceIndex: 0, 
        parent: source, 
        target: nodeId, 
        // targetIndex: 0, 
        level: listNumber > 1 ? level : level - 1, 
        card: note.card, 
        reviewed: study ? note.card!.due > now : true, 
      });
      linkIndex++;
    }

    originIds.forEach((id, i) => {
      if (id) {
        const nodeIndex = this.nodes.findIndex((node) => node.id === id);
        if (nodeIndex == -1) {
          console.log("loadMindMap() node origin not found:", id, this.nodes.findIndex((node) => node.id === id));
          return;
        }
      }
    });

    for (let i = 0; i < this.links.length; i++) {
      const sourceId = this.links[i].source as string;
      const sourceNode = this.nodes.find(node => node.id === sourceId);
      const targetId = this.links[i].target as string;
      const targetNode = this.nodes.find(node => node.id === targetId);
      if (!sourceNode || !targetNode) {
        console.log("loadMindMap() node(s) not found:", sourceId, targetId);
        continue;
      }

      // this.links[i].sourceIndex = sourceNode.index;
      // this.links[i].targetIndex = targetNode.index;
      // this.links[i].cardOrigin = targetNode.listNumber ? targetNode.cardOriginIndex : sourceNode.index;
      this.nodes[sourceNode.index].linksTo.push(i);
      // if (this.links[i].card) this.nodes[sourceNode.index].hasStudyableChildren = true;
    }

    // console.log(this.nodes);
    // console.log(this.links);
    // console.log(originIds);
  }

  async createGraph() {
    const presetLayout = this.layout.ids.length != 0;
    console.log("MindMapView.createGraph(): preset layout:", presetLayout);

    this.graphContainer.empty();

    this.graphContainer.appendChild(this.labelContainer);
    this.graphContainer.appendChild(this.ratingInterfaceAnchor);

    this.simulation = d3.forceSimulation<Node>(this.nodes)
      // .force('link', d3.forceLink<Node, Link>(this.links).id(d => d.id))
      .force('link', d3.forceLink<Node, Link>(this.links).id(d => d.id).strength(0.2))
      .force('collide', d3.forceCollide().radius(d => (d as Node).collideRadius * this.minFontSize * 0.75).strength(0.05))
      .force('center', d3.forceCenter().strength(this.mindMap.map.separateHeadings ? 1 : 0))
      .force('x', d3.forceX().strength(0.005))
      .force('y', d3.forceY().strength(0.005))
      .force('charge', d3.forceManyBody().strength(this.mindMap.map.separateHeadings ? -10 : -30).distanceMin(120))
      .alpha(presetLayout ? 0 : INITIAL_ALPHA)
      .alphaDecay(INITIAL_ALPHADECAY)
      .alphaMin(MIN_ALPHA)
      .on('tick', () => this.updateGraph());
    // this.simulation.stop();

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
        .attr('stroke-width', 3);

    this.node = this.svg.append('g')
      .selectAll<SVGCircleElement, Node>('circle')
      .data(this.nodes)
      .join('circle')
        .attr('id', d => d.id)
        .attr('nodeIndex', d => d.index)
        .attr('fill', d => nodeFill(this.viewMode, d, this.links))
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
            if (d.level == 0) return;
            if (!event.active) this.simulation.alpha(DRAG_ALPHA).alphaDecay(0).restart();
            d.fx = d.x ? d.x : null;
            d.fy = d.y ? d.y : null;
        })
        .on('drag', (event, d) => {
            if (this.viewMode != ViewMode.Arrange) return;
            if (d.level == 0) return;
            const k = this.transform.k;
            d.fx = d.x! + event.dx / k / xStretch;
            d.fy = d.y! + event.dy / k;
        })
        .on('end', (event, d) => {
            if (!event.active) this.simulation.alphaTarget(0).alphaDecay(DRAG_ALPHADECAY);
            d.fx = d.level == 0 ? 0 : null;
            d.fy = d.level == 0 ? 0 : null;
        })
      );

    this.labelContainer.empty();
    this.labels = [];
    this.labelAnchors = [];
    for (const node of this.nodes) {
      const anchor = document.createElement('div');
      anchor.addClass("mind-map-label-anchor");
      const label = document.createElement('span');
      label.addClass("mind-map-label");
      label.append(node.content);
      // label.textContent = node.content;
      anchor.style.fontSize = fontSize(this.minFontSize, this.minFontSize * this.maxFontScale, node.level);
      // anchor.style.width = `${Math.sqrt(node.content.textContent.length) * 1.33}em`;
      anchor.style.width = `${Math.sqrt(node.content.textContent.length) * xStretch}em`;
      anchor.appendChild(label);
      this.labels.push(label);
      this.labelAnchors.push(anchor);
      this.labelContainer.appendChild(anchor);
    }

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
    const clickedLabel = this.labels[node.index].cloneNode(true);
    // console.log("clicked node label:", clickedLabel);
    // console.log("clicked node label now:", this.labels[node.index]);
    switch (this.viewMode) {
      case ViewMode.Arrange: 
        break;
      case ViewMode.Navigate:
        this.focusNodes(node, 2, 2);
        break;
      case ViewMode.Study:
        if (!this.selectedNode) {
          console.log("handleNodeClick() Study");
          if (!this.interactableNodes.contains(node)) {
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
    const link = this.interactableLinks.find(link => link.target == node);
    if (link === undefined) {
      console.log("studyNodeInteract() error: link does not exist. interactable:", this.interactableLinks, "node:", node);
      return;
    }
    const card = link.card;
    if (!card) {
      console.log("studyNodeInteract() error: card does not exist.");
      return;
    }
    this.selectedLink = link;
    this.cardPreview = this.fsrs.repeat(card, this.now);
    this.selectedNode = node;
    this.interactableNodes.remove(node);
    this.interactableLinks.remove(link);

    const nodeSvg = this.node.filter((_, i) => i == node.index);
    nodeSvg.attr('stroke-width', 0);
    // this.labels[node.index].show();
    this.labels[node.index].replaceChildren(node.content);
    this.showRatingInterface(event, node);
  }

  showRatingInterface(event: any, node: Node) {
    const x = node.x! * xStretch;
    const y = node.y!;
    this.ratingInterfaceOffset = this.labels[node.index].clientHeight / 2 + 10;
    console.log("showRatingInterface() offset:", this.ratingInterfaceOffset);
    this.ratingInterface.show();
    this.ratingInterfaceAnchor.style.left = (this.width / 2 + (x * this.transform.k) + this.transform.x).toString() + "px";
    this.ratingInterfaceAnchor.style.top = (this.height / 2 + (y * this.transform.k) + this.transform.y + this.ratingInterfaceOffset).toString() + "px";
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
    this.selectedLink = null;
    this.ratingInterface.hide();
  }

  handleRatingInput(grade: Grade) {
    this.selectedLink!.card = this.cardPreview[grade].card;
    // console.log(`handleRatingInput() ${this.links[this.selectedLinkIndex!].source} -> ${this.links[this.selectedLinkIndex!].target}; new card:`, this.links[this.selectedLinkIndex!].card);
    console.log(
      "handleRatingInput() studied:", 
      this.selectedLink!.source, "->", this.selectedLink!.target, 
      "rating:", grade,
      "new card:", this.selectedLink!.card
    );
    this.deselect();
    if (this.interactableNodes.length == 0) this.goToNextNode();
  }

  updateGraph() {
    console.log("updateGraph()");
    if (this.simulationRunning) {
      this.simulation.alphaTarget(INITIAL_ALPHA);
    }
    // Update positions on each tick
    // this.simulation.nodes(this.nodes);
    // (this.simulation.force('link') as d3.ForceLink<Node, Link>).links(this.links);

    this.link
      .attr('x1', d => (d.source as Node).x! * xStretch)
      .attr('y1', d => (d.source as Node).y!)
      .attr('x2', d => (d.target as Node).x! * xStretch)
      .attr('y2', d => (d.target as Node).y!);

    this.node
      .attr('cx', d => d.x! * xStretch)
      .attr('cy', d => d.y!)
      .each((d, i) => {
        const k = this.transform.k;
        const tx = d.x! * xStretch * k;
        const ty = d.y! * k;
        this.labelAnchors[i].style.left = tx.toString() + "px";
        this.labelAnchors[i].style.top = ty + "px";
      });
    
    if (this.simulation.alpha() < MIN_ALPHA) this.saveLayout();
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
      // .attr('r', d => nodeRadius(d) / k)
      // .attr("stroke-width", (d, i) => this.interactableNodes.contains(i) ? 2 / k : 0);
      .attr("stroke-width", (d, i) => /* this.interactableNodes.contains(i) ? 1 : */ 0)
      .each((d, i) => {
        const tx = d.x! * xStretch * k;
        const ty = d.y! * k;
        this.labelAnchors[i].style.left = tx.toString() + "px";
        this.labelAnchors[i].style.top = ty + "px";
        this.labelAnchors[i].style.fontSize = fontSize(this.minFontSize * k, this.minFontSize * this.maxFontScale * k, d.level);
      });
      
    this.link
      .attr("transform", transform);
      // .attr("stroke-width", 2 / k);

    if (this.selectedNode) {
      const nodePosition = [this.selectedNode.x!, this.selectedNode.y!];
      this.ratingInterfaceAnchor.style.left = (this.width / 2 + (nodePosition[0] * xStretch * k + x)).toString() + "px";
      this.ratingInterfaceAnchor.style.top = (this.height / 2 + nodePosition[1] * k + y + this.ratingInterfaceOffset).toString() + "px";
    }

    this.labelContainer.style.left = (this.width / 2 + x).toString() + "px";
    this.labelContainer.style.top = (this.height / 2 + y).toString() + "px";
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

  getRelatedNodes(node: Node, backDepth: number, forwardDepth: number): Node[] {
    let nodes: Node[] = []; // final list of nodes
    let parents: Node[] = [node]; // parent nodes, parents of parents, to back depth
    let children: Node[] = [node]; // child nodes, children of children, to forward depth

    let startIndex = 0; // start of index list to branch from
    let newIndex = 0;
    for (let d = 0; d < backDepth; d++) {
      newIndex = parents.length; 
      parents.slice(startIndex).forEach(node => {
        const linksToNode = this.links.filter(link => link.target == node);
        const parentNodes = linksToNode.map(link => link.parent as Node);
        parents.push(...parentNodes);
      });
    }
    startIndex = 0;
    for (let d = 0; d < forwardDepth; d++) {
      newIndex = children.length;
      children.slice(startIndex).forEach((node) => {
        const linksFromNode = this.links.filter(link => link.source == node || link.parent == node);
        children.push(...linksFromNode.map(link => link.target as Node));
      });
      startIndex = newIndex; // start from the new nodes next iteration
    }
    parents.forEach(node => {
      if (!nodes.contains(node)) nodes.push(node);
    });
    children.forEach(node => {
      if (!nodes.contains(node)) nodes.push(node);
    });
    // console.log("getNodeIndices() nodes:", indices.map(index => this.nodes[index]));
    return nodes;
  }

  focusNodes(node?: Node, backDepth?: number, forwardDepth?: number) {
    let nodes: Node[] = [];
    let indices: number[] = [];
    backDepth = backDepth ? backDepth : 0;
    forwardDepth = forwardDepth ? forwardDepth : (backDepth ? backDepth : 0);

    if (node) {
      nodes = this.getRelatedNodes(node, backDepth, forwardDepth);
      this.updateVisibility(nodes);
    } else {
      nodes = this.nodes;
      this.updateVisibility();
    }

    const xCoords = nodes.map((node) => node.x! * xStretch);
    const yCoords = nodes.map((node) => node.y!);
    let minX = Math.min(...xCoords);
    let maxX = Math.max(...xCoords);
    let minY = Math.min(...yCoords);
    let maxY = Math.max(...yCoords);
    const frameCentreX = (minX + maxX) * 0.5;
    const frameCentreY = (minY + maxY) * 0.5;
    const frameWidth = Math.max(maxX - minX, 1) + 120 * xStretch;
    const frameHeight = Math.max(maxY - minY, 1) + 120;
    const scaleF = Math.min(this.width / frameWidth, this.height / frameHeight);
    const transform = d3.zoomIdentity
        .scale(Math.min(Math.max(scaleF, SCALE_EXTENT[0]), SCALE_EXTENT[1]))
        .translate(-frameCentreX, -frameCentreY);
    // console.log("focusNodes")
    this.svg.transition().duration(500).call(
      this.zoom.transform,
      transform, 
    );
  }

  toggleLabels() {
    this.showLabels = !this.showLabels;
    this.toggleLabelButton.textContent = `${this.showLabels ? "Hide" : "Show"} labels`;
    if (this.showLabels) {
      this.labels.forEach(label => label.show());
    } else {
      this.labels.forEach(label => label.hide());
    }
  }

  updateVisibility(nodes?: Node[]) {
    if (!nodes) {
      this.node.attr('opacity', "100%");
      this.link.attr('opacity', "100%");
      this.labels.forEach(label => {
        label.style.opacity = "100%";
        label.show()
      });
      return;
    }

    if (this.viewMode == ViewMode.Navigate) {
      this.node.attr('opacity', d => nodes.contains(d) ? "100%" : "25%");
      this.link.attr('opacity', d => {
        const containsTarget = nodes.contains(d.target as Node);
        const containsSource = nodes.contains(d.source as Node);
        return containsTarget && containsSource ? "100%" : "25%";
      });
      this.labels.forEach((label, i) => {
        label.style.opacity = nodes.some(node => node.index == i) ? "100%" : "25%";
        if (this.showLabels) label.show();
      });
    } else if (this.viewMode == ViewMode.Study) {
      this.node.attr('opacity', d => {
        if (nodes.contains(d)) {
          if (this.interactableNodes.contains(d) || nodes[0] == d) {
            return "100%";
          } else {
            return "50%";
          }
        } else {
          return "25%";
        }
      });
      this.link.attr('opacity', d => {
        const containsTarget = nodes.contains(d.target as Node);
        const containsSource = nodes.contains(d.source as Node);
        if (containsTarget && containsSource) {
          if (this.interactableLinks.contains(d)) {
            return "100%";
          } else {
            return "50%";
          }
        } else {
          return "25%";
        }
      });
      this.labels.forEach((label, i) => {
        let opacity = "";
        if (nodes.some(node => node.index == i)) {
          if (this.showLabels) label.show();
          if (nodes.some(node => node.index == i) || nodes[0] == this.nodes[i]) { // node can be clicked or is the parent
            opacity = "100%";
          } else { // node can not be clicked
            opacity = "75%";
          }
        } else {
          label.hide();
        }
        label.style.opacity = opacity;
      });
    }
  }

  changeViewMode(mode?: ViewMode) {
    let buttonText = "";
    this.stopSimulation();
    if (mode) {
      this.viewMode = mode;
    } else {
      switch(this.viewMode) { // cycle through options
        case ViewMode.Arrange: 
          this.viewMode = ViewMode.Navigate; 
          this.focusNodes();
          break;
        case ViewMode.Navigate: 
          this.viewMode = ViewMode.Study; 
          this.goToNextNode();
          break;
        case ViewMode.Study:
          this.viewMode = ViewMode.Arrange; 
          this.focusNodes();
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
        if (!link.reviewed) hiddenNodes[(link.target as Node).index] = true;
      });
      this.labels.forEach((label, i) => {
        const node = this.nodes[i];
        const text = hiddenNodes[i] ? node.hidden : node.content;
        label.replaceChildren(text);
      });
    } else {
      this.labels.forEach((label, i) => label.replaceChildren(this.nodes[i].content));
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

  stopSimulation() {
    this.simulationButton.textContent = "Run simulation";
    this.simulation.alphaTarget(0).alphaDecay(INITIAL_ALPHADECAY);
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

  // sets interactable nodes and links
  setInteractable(parent: Node) {
    const nodes = this.getRelatedNodes(parent, 0, 1); // select immediate children
    nodes.shift(); // only children
    const links = this.links.filter(link => link.card) // has card
                            .filter(link => link.parent == parent) // card is from the parent
                            .filter(link => !link.reviewed); // not reviewed yet
    // console.log("setInteractable(): links:", links.map(link => link));
    this.interactableNodes = links.map(link => link.target as Node);
    this.interactableLinks = links;
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
    const linksDue = this.links.filter(link => link.card && !link.reviewed); // links with unreviewed cards
    const nodes = linksDue.map(link => link.target as Node);

    if (nodes.length == 0) {
      new Notice("No notes due", 0);
      console.log("no notes due");
      this.selectedNode = null;
      this.interactableNodes = [];
      this.interactableLinks = [];
      return;
    }

    linksDue.sort((a, b) => a.level - b.level);
    const parent = linksDue[0].parent as Node;
    this.selectedParent = parent;
    this.setInteractable(parent);
    this.focusNodes(parent, 1, 1);
    console.log("goToNextNode() parent:", parent);
  }

  viewImage(url: string) {

  }
}

function nodeRadius (node: Node) { 
  if (node.level == 0) {
    return 18;
  } else {
    return 12 + 6 / (node.level + 1);
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
  return node.level == 0 ? 'white' : colour(node.level);
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
      if (!link.reviewed) return "8 4";
    }
  }
  return "";
}

function fontSize(min: number, max: number, level: number): string {
  const d = max - min;
  return (Math.round((d / (level + 1) + min) * 2) * 0.5).toString() + "px";
}

function collideRadius(text: string): number {
  // console.log("collideRadius()", text, Math.sqrt(text.length)); 
  return Math.sqrt(text.length);
}