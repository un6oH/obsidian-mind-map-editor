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
import { MapStudySettingsEditorModal as MapStudySettingsInspector, NotePropertyEditorModal, noteTagPattern, mapTagPattern } from 'main';
import { EditorRange, Plugin } from 'obsidian';

class MapStudyParametersWidget extends WidgetType {
  plugin: Plugin;
  view: EditorView;
  from: number; 
  to: number;

  constructor(plugin: Plugin, view: EditorView, from: number, to: number) {
    super();
    this.plugin = plugin;
    this.view = view;
    this.from = from;
    this.to = to;
  }

  toDOM() {
    const button = document.createElement('a');
    button.textContent = 'Inspect map settings';
    button.className = "widget-map-metadata";
    button.onclick = () => {  
      new MapStudySettingsInspector(this.plugin, this.view, this.from + 4, this.to - 5).open();
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
  from: number; 
  to: number;

  constructor(plugin: Plugin, view: EditorView, from: number, to: number) {
    super();
    this.plugin = plugin;
    this.view = view;
    this.from = from;
    this.to = to;
  }

  toDOM() {
    const button = document.createElement('a');
    button.textContent = 'inspect note';
    button.className = "widget-note-data";
    button.onclick = () => {  
      // console.log("inspect note");
      new NotePropertyEditorModal(this.plugin, this.view, this.from + 5, this.to - 6).open();
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
          const text = view.state.doc.sliceString(from, to);
          // console.log(text);

          let noteMatch;
          const noteTagRegex = RegExp(noteTagPattern, 'gm');
          let i = 0;
          while ((noteMatch = noteTagRegex.exec(text)) !== null && i < 100) {
            // console.log(noteMatch);
            const start = from + noteMatch.index + 1;
            const end = start + noteMatch[0].length - 2;
            const deco = Decoration.replace({
              widget: new NoteDataWidget(plugin, view, start, end),
              inclusive: false
            });
            decorations.push({start, end, deco});
            i++;
          }
          
          let mapMatch;
          const mapTagRegex = RegExp(mapTagPattern, 'gm');
          let j = 0;
          while ((mapMatch = mapTagRegex.exec(text)) !== null && j < 10) {
            // console.log(mapMatch);
            const start = from + mapMatch.index + 1;
            const end = start + mapMatch[0].length - 2;
            const deco = Decoration.replace({
              widget: new MapStudyParametersWidget(plugin, view, start, end),
              inclusive: false
            });
            decorations.push({start, end, deco});
            j++
          }
        }
        decorations.sort((a, b) => a.start - b.start);
        // console.log(decorations);
        decorations.forEach(deco => builder.add(deco.start, deco.end, deco.deco));
        return builder.finish();
      }
    }, {
      decorations: v => v.decorations
    });
}
