import {
  ViewUpdate,
  PluginValue,
  EditorView,
  ViewPlugin,
  WidgetType,
  DecorationSet,
  Decoration,
  PluginSpec,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { MapStudySettingsEditorModal, NotePropertyEditorModal, notePattern, noteTagPattern, mapTagPattern } from 'main';
import { EditorRange, Plugin } from 'obsidian';

class MapStudyParametersWidget extends WidgetType {
  plugin: Plugin;
  view: EditorView;
  from: number; // index of tag
  to: number;

  constructor(plugin: Plugin, view: EditorView, from: number, to: number) {
    super();
    this.plugin = plugin;
    this.view = view;
    this.from = from;
    this.to = to;
    // console.log("created map widget");
  }

  toDOM() {
    const button = document.createElement('a');
    button.textContent = 'Inspect map settings';
    button.className = "widget-map-metadata";
    button.onclick = () => {  
      // console.log("creating map settings editor modal");
      new MapStudySettingsEditorModal(this.plugin, this.view, this.from, this.to).open();
    };
    return button;
  }

  ignoreEvent() {
    return false;
  }
}

class NoteDataWidget extends WidgetType {
  plugin: Plugin;
  view: EditorView;
  indices: number[][];

  constructor(plugin: Plugin, view: EditorView, indices: number[][]) {
    super();
    this.plugin = plugin;
    this.view = view;
    this.indices = indices;
  }

  toDOM() {
    const button = document.createElement('a');
    button.textContent = 'inspect note';
    button.className = "widget-note-data";
    button.onclick = () => {
      // console.log("inspect note");
      new NotePropertyEditorModal(this.plugin, this.view, this.indices).open();
    };
    return button;
  }

  ignoreEvent() {
    return false;
  }
}

export function createMindMapEditorViewPlugin(plugin: Plugin) {
  return ViewPlugin.fromClass(
    class MindMapEditorViewPlugin implements PluginValue {
      decorations: DecorationSet;
    
      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }
    
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.buildDecorations(update.view);
        }
      }
    
      destroy() {}
    
      buildDecorations(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const decorations: {start: number, end: number, deco: Decoration}[] = [];
        // console.log(view.visibleRanges);
        for (let { from, to } of view.visibleRanges) {
          // console.log("range: from", from, "to", to);
          const text = view.state.doc.sliceString(from, to);
          // console.log(text);

          let noteMatch;
          const noteRegex = RegExp(notePattern, 'dgm');
          // find every match in the full text
          while ((noteMatch = noteRegex.exec(text)) !== null) {
            // console.log(noteMatch);
            const indices: number[][] = (noteMatch as any).indices;

            // widget replaces <{note>...<\/note}>
            const start = from + indices[2][0] - 5; 
            const end = from + indices[2][1] + 6;
            const deco = Decoration.replace({
              widget: new NoteDataWidget(plugin, view, indices),
              inclusive: false
            });
            decorations.push({start, end, deco});
          }
          
          let mapMatch;
          const mapTagRegex = RegExp(mapTagPattern, 'gm');
          while ((mapMatch = mapTagRegex.exec(text)) !== null) {
            // console.log(mapMatch);
            const start = from + mapMatch.index; // index of full tag
            const end = start + mapMatch[0].length;
            const deco = Decoration.replace({
              widget: new MapStudyParametersWidget(plugin, view, start, end),
              inclusive: false
            });
            decorations.push({start: start + 1, end: end - 1, deco});
          }
        }
        decorations.sort((a, b) => a.start - b.start);
        // console.log(decorations);
        decorations.forEach(deco => builder.add(deco.start, deco.end, deco.deco));
        return builder.finish();
      }
    }, {
      decorations: v => v.decorations
    }
  );
}
