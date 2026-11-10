import {
  ViewUpdate,
  PluginValue,
  EditorView,
  ViewPlugin,
  WidgetType,
  DecorationSet,
  Decoration
} from '@codemirror/view';
import { Line, RangeSetBuilder } from '@codemirror/state';
import { MapSettingsEditorModal, NoteEditorModal } from 'modals';
import { App, Plugin } from 'obsidian';
import { notePattern, mapTagPattern, errorPattern, parseNote, colour, cardStateColours, canStudy, parseMapTag, formatContent, cardTagOpen, cardTagClose } from 'helpers';
import { MapSettings, Note, Warning } from 'types';

class MapTitleWidget extends WidgetType {
  app: App;
  map: MapSettings;
  match: RegExpExecArray;

  constructor(app: App, match: RegExpExecArray) {
    super();
    this.app = app;
    this.match = match;
    this.map = parseMapTag(match[1]);
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.addClass('widget-map-title');

    const title = document.createElement('h1');
    title.textContent = this.map.title;
    container.appendChild(title);

    return container;
  }

  ignoreEvent() {
    return false;
  }
}

function createButton(textContent: string, id: string, clickHandler: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = textContent;
  button.addClass('widget-map-button');
  button.id = id;
  button.onclick = clickHandler;
  return button;
}

class MapMenuWidget extends WidgetType {
  app: App;
  map: MapSettings;
  match: RegExpExecArray;
  mindMapPos: number;
  checkNotesCallback: () => void;
  updateCardsCallback: () => void;
  viewMindMapCallback: (mindMapPos: number) => void;
  constructor(app: App, match: RegExpExecArray, mindMapPos: number, checkNotesCallback: () => void, updateCardsCallback: () => void, viewMindMapCallback: (mindMapPos: number) => void) {
    super();
    this.app = app;
    this.match = match;
    this.map = parseMapTag(match[1]);
    this.mindMapPos = mindMapPos;
    this.checkNotesCallback = checkNotesCallback;
    this.updateCardsCallback = updateCardsCallback;
    this.viewMindMapCallback = viewMindMapCallback;
  }
  
  toDOM(view: EditorView) {
    const menu = document.createElement('div');
    menu.addClass("widget-map-menu");
    menu.append(createButton("Settings", "widget-map-settings-button", () => {
      // console.log("creating map settings editor modal");
      new MapSettingsEditorModal(this.app, view, this.match).open();
    }));
    menu.append(createButton("Check Notes", "widget-map-check-notes-button", this.checkNotesCallback));
    menu.append(createButton("Update Cards", "widget-map-update-cards-button", this.updateCardsCallback));
    menu.append(createButton("View Mind Map", "widget-map-open-button", () => this.viewMindMapCallback(this.mindMapPos)));
    return menu;
  }
}

class NoteDataWidget extends WidgetType {
  app: App = {} as App;
  view: EditorView = {} as EditorView;
  match: RegExpExecArray;
  note: Note;
  level: number;

  // match: match of list item or note
  constructor(app: App, match: RegExpExecArray) {
    super();
    this.app = app;
    this.match = match;
    this.note = parseNote(match);
    this.level = match[1].length;
  }

  toDOM(view: EditorView) {
    // icon container
    const icon = document.createElementNS("http://www.w3.org/2000/svg", 'svg');
    icon.addClass("widget-node-icon");
    icon.setAttributeNS(null, "viewBox", "0 0 24 24");
    icon.setAttributeNS(null, "width", "24px");
    icon.setAttributeNS(null, "height", "24px");
    // main circle
    const circle = document.createElementNS("http://www.w3.org/2000/svg", 'circle');
    circle.setAttributeNS(null, "cx", "12");
    circle.setAttributeNS(null, "cy", "12");
    circle.setAttributeNS(null, "r", this.note.card ? "12" : "6");
    circle.setAttributeNS(null, "fill", colour(this.level));
    icon.appendChild(circle);
    // inner circle / status indicator
    if (this.note.card) {
      const innerCircle = document.createElementNS("http://www.w3.org/2000/svg", 'circle');
      innerCircle.setAttributeNS(null, "cx", "12");
      innerCircle.setAttributeNS(null, "cy", "12");
      innerCircle.setAttributeNS(null, "r", "8");
      innerCircle.setAttributeNS(null, "fill", cardStateColours[this.note.card.state]);
      icon.appendChild(innerCircle);
    }

    const block = document.createElement('span');
    block.addClass('widget-note');
    block.addClass(this.note.card ? 'widget-note-study' : 'widget-note-nostudy');

    block.appendChild(icon);
    block.appendChild(formatContent(document, this.note.content, () => {}).content);
    /* if (this.note.id !== undefined) {
      const tag = document.createElement('span');
      tag.addClass('cm-hashtag');
      tag.textContent = "#" + this.note.id;
      block.appendText(this.note.content ? " (" : "(");
      block.appendChild(tag);
      block.appendText(")");
    } */

    const study = canStudy(this.note.content, this.note.type);
    if (study == (this.note.card == null)) {
      block.addClass('conflict');
    }

    block.onclick = () => {
      new NoteEditorModal(this.app, view, this.match).open();
    };

    return block;
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
  "(other key words referencing this also have children)", 
  "(this key word references a key word that has children)", 
  "(tag does not have associated content)", 
  "(conflicting content associated with this tag)", 
];

const warningMessages: string[] = [];
warningMessages[Warning.EmptyLine] = "Empty line.";
warningMessages[Warning.Invalid] = "Invalid format.";
warningMessages[Warning.DuplicateKeyWord] = "";
warningMessages[Warning.DuplicateRelation] = "";
warningMessages[Warning.LinkConflict] = "Only one linked note can have children. Consolidate the children under one note or unlink the parents using \"*\" OR tags";
warningMessages[Warning.ContentConflict] = "Some notes with this tag have different associated content. Make sure all of the notes have the same content (case-insensitive) OR only one of the notes have content.";
warningMessages[Warning.ContentNotDefined] = "None of the notes with this tag have associated content.";
warningMessages[Warning.StudyConflict] = "Card does not match content type";

class ErrorWidget extends WidgetType {
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

    const deleteButton = document.createElement('a');
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

export function createMindMapEditorViewPlugin(plugin: Plugin, checkNotesCallback: () => void, createCardsCallback: () => void, studyCallback: (mindMapPos: number) => void) {
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
        for (let { from, to } of view.visibleRanges) {
          const text = view.state.doc.sliceString(from, to);

          // do note matching line by line
          // sliceString does not include original text. excludes image tags
          let lineStart = from;
          let lineEnd = 0;
          let lines: Line[] = [];
          while (lineEnd < to) {
            let line = view.state.doc.lineAt(lineStart);
            lineEnd = line.to;
            lineStart = line.to + 1;
            lines.push(line);
          }
        
          for (let line of lines) {
            const noteRegex = RegExp(notePattern, 'd'); 
            let noteMatch = noteRegex.exec(line.text);
            if (noteMatch) {
              const indices = (noteMatch as any).indices;
              indices.forEach((pair: number[], i: number, array: number[][]) => 
                array[i] = [pair[0] + line.from, pair[1] + line.from]); 

              const start = indices[4][0] - cardTagOpen.length;
              const end = indices[4][1] + cardTagClose.length;

              const deco = Decoration.replace({
                widget: new NoteDataWidget(plugin.app, noteMatch),
                inclusive: false
              });
              decorations.push({ start, end, deco });
            }
          }
          
          let mapMatch;
          const mapTagRegex = RegExp(mapTagPattern, 'dgm');
          while ((mapMatch = mapTagRegex.exec(text)) !== null) {
            const indices = (mapMatch as any).indices;
            indices[0] = [indices[0][0] + from, indices[0][1] + from];
            const pos = view.state.doc.lineAt(indices[0][0]).number;

            decorations.push({ 
              start: indices[0][0], 
              end: indices[0][1], 
              deco: Decoration.replace({ widget: new MapTitleWidget(plugin.app, mapMatch) })
            });
            decorations.push({
              start: indices[0][1],
              end: indices[0][1],
              deco: Decoration.widget({ widget: new MapMenuWidget(plugin.app, mapMatch, pos, checkNotesCallback, createCardsCallback, studyCallback) })
            });
          }

          let errorMatch;
          const errorRegex = RegExp(errorPattern, 'dgm');
          while ((errorMatch = errorRegex.exec(text)) !== null) {
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
