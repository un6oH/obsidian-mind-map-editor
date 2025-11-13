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
import { MapStudySettingsEditorModal, NotePropertyEditorModal } from 'modals';
import { EditorRange, Plugin } from 'obsidian';
import { notePattern, noteTagPattern, mapTagPattern, mapTagOpen, mapTagClose, noteTagOpen, noteTagClose, errorTagPattern } from 'helpers';
import { Warning } from 'types';

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
  isKeyWord: boolean;
  isStudyable: boolean;

  constructor(plugin: Plugin, view: EditorView, indices: number[][], isKeyWord: boolean, isStudyable: boolean) {
    super();
    this.plugin = plugin;
    this.view = view;
    this.indices = indices;
    this.isKeyWord = isKeyWord;
    this.isStudyable = isStudyable;
  }

  toDOM() {
    const button = document.createElement('a');
    button.textContent = this.isKeyWord ? "key word" : "relation";
    button.addClass(this.isKeyWord ? 'widget-note-keyword' : 'widget-note-relation');
    button.addClass(this.isStudyable ? 'widget-note-study' : 'widget-note-nostudy');
    button.onclick = () => {
      // console.log("NoteDataWidget() indices", this.indices);
      new NotePropertyEditorModal(this.plugin, this.view, this.indices).open();
    };
    return button;
  }

  ignoreEvent() {
    return false;
  }
}

const warningNames = [
  "(Empty line)", 
  "(Invalid format)", 
  "(Duplicate relation)", 
  "(Duplicate key word)", 
];

class ErrorWidget extends WidgetType {
  view: EditorView;
  indices: number[][];
  warning: Warning;

  constructor(indices: number[][], warning: Warning) {
    super();
    // this.view = view;
    this.indices = indices;
    this.warning = warning;
  }

  toDOM(view: EditorView) {
    const warningMessage = document.createElement('span');
    warningMessage.addClass('widget-error-warning');
    warningMessage.textContent = " " + warningNames[this.warning] + " ";

    const deleteButton = document.createElement('a')
    deleteButton.textContent = "delete";
    deleteButton.addClass('widget-error-delete');
    // deleteButton.onclick = this.deleteLine;
    const newLineOffset = this.indices[0][0] == 0 ? 0 : -1;
    deleteButton.onclick = () => view.dispatch({
      changes: {
        from: this.indices[0][0] + newLineOffset, 
        to: this.indices[0][1],
      }, 
      selection: { anchor: this.indices[0][0] + newLineOffset }
    });

    const okButton = document.createElement('a');
    okButton.textContent = "OK";
    okButton.addClass('widget-error-dismiss');
    // okButton.onclick = this.dismissError;
    okButton.onclick = () => view.dispatch({
      changes: {
        from: this.indices[1][0], 
        to: this.indices[1][1],
      }, 
      selection: { anchor: this.indices[1][0] }
    });

    const widget = document.createElement('span');
    widget.append(warningMessage);
    widget.append(deleteButton);
    widget.appendText(" | ");
    widget.append(okButton);

    return widget;
  }
  
  ignoreEvent() {
    return false;
  }
}

export function createMindMapEditorViewPlugin(plugin: Plugin) {
  const mapTagOpenLength = mapTagOpen.length;
  const mapTagCloseLength = mapTagClose.length;
  const noteTagOpenLength = noteTagOpen.length;
  const noteTagCloseLength = noteTagClose.length;

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

          let noteMatch;
          const noteRegex = RegExp(notePattern, 'dgm');
          // find every match in the full text
          while ((noteMatch = noteRegex.exec(text)) !== null) {
            // console.log("View plugin: note match:", noteMatch[0]);
            let indices: number[][] = (noteMatch as any).indices;
            indices = indices.map((pair) => [pair[0] + from, pair[1] + from]);
            const content = noteMatch[2].trim();
            let isKeyWord = !content.endsWith(':');
            const props = noteMatch[3];
            let isStudyable = props.contains('true');

            // widget replaces <{note>...<\/note}>
            const start = indices[3][0] - noteTagOpenLength;
            const end = indices[3][1] + noteTagCloseLength;
            const deco = Decoration.replace({
              widget: new NoteDataWidget(plugin, view, indices, isKeyWord, isStudyable),
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
            decorations.push({start, end, deco});
          }

          let errorMatch;
          const errorTagRegex = RegExp(errorTagPattern, 'dgm');
          while ((errorMatch = errorTagRegex.exec(text)) !== null) {
            let indices: number[][] = (errorMatch as any).indices;
            indices = indices.map((pair) => [pair[0] + from, pair[1] + from]);
            const start = indices[1][0];
            const end = indices[1][1];
            const warning = parseInt(errorMatch[2]);
            const deco = Decoration.replace({
              widget: new ErrorWidget(indices, warning),
              inclusive: false
            });
            decorations.push({start, end, deco});
          }

          // let tabMatch;
          // const tabMatchRegex = RegExp("^\\t+", 'dgm');
          // while ((tabMatch = tabMatchRegex.exec(text)) !== null) {
          //   let indices: number[][] = (tabMatch as any).indices;
          //   const start = indices[0][0];
          //   const end = indices[0][1];
          //   const deco = Decoration.mark({
          //     class: "mark-tabs"
          //   });
          //   decorations.push({start, end, deco});
          // }

          let spaceMatch;
          const spaceMatchRegex = RegExp("\\t+?( +)|( +)\\t+?", 'dgm');
          while ((spaceMatch = spaceMatchRegex.exec(text)) !== null) {
            let indices: number[][] = (spaceMatch as any).indices;
            const group = indices[1] ? 1 : 2;
            const start = indices[group][0] + from;
            const end = indices[group][1] + from;
            const deco = Decoration.mark({
              class: "mark-indent-error"
            });
            decorations.push({start, end, deco});
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
