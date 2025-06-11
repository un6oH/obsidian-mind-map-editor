import { ItemView, WorkspaceLeaf } from 'obsidian';

export const VIEW_TYPE_MIND_MAP = 'mind-map-view';

export class MindMapView extends ItemView {
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
    const app = this.app;
    const container = this.containerEl.children[1];
    container.empty();
    
  }

  async onClose() {
    // Nothing to clean up.
  }
}