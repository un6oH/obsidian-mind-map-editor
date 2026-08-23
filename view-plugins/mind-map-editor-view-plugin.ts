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
import { EditorSelection, RangeSetBuilder } from '@codemirror/state';
import { MapSettingsEditorModal, NotePropertyEditorModal } from 'modals';
import { App, EditorRange, Plugin } from 'obsidian';
import { notePattern, mapTagPattern, mapTagOpen, mapTagClose, errorPattern, removeTags, idTagRegex, getNoteId, parseNote, colour, cardStateColours, parseListItem, cardTagRegex, canStudy, noteRegex, listItemPattern, parseMapTag, formatContent, cardTagOpen, cardTagClose } from 'helpers';
import { ListItem, MapSettings, Note, Warning } from 'types';
import { Card, State } from 'ts-fsrs';
import { createCards } from 'main';

class ControlPanel extends WidgetType {
  app: App;
  map: MapSettings;
  match: RegExpExecArray;
  checkNotesCallback: () => void;
  createCardsCallback: () => void;
  studyCallback: () => void;

  constructor(app: App, match: RegExpExecArray, checkNotesCallback: () => void, addCardsCallback: () => void, studyCallback: () => void) {
    super();
    this.app = app;
    this.match = match;
    this.map = parseMapTag(match[1]);
    this.checkNotesCallback = checkNotesCallback;
    this.createCardsCallback = addCardsCallback;
    this.studyCallback = studyCallback;
  }

  toDOM(view: EditorView) {
    const container = document.createElement('div');
    container.addClass('widget-map-title');

    const title = document.createElement('h1');
    title.textContent = this.map.title;
    container.appendChild(title);

    /* const settingsButton = document.createElement('button');
    settingsButton.textContent = 'Settings';
    settingsButton.addClass("widget-map-button");
    settingsButton.id = 'widget-map-settings-button';
    settingsButton.onclick = () => {
      // console.log("creating map settings editor modal");
      new MapSettingsEditorModal(this.app, view, this.match).open();
    };
    container.appendChild(settingsButton); */

    /* const checkNotesButton = document.createElement('button');
    checkNotesButton.textContent = 'Check Notes';
    checkNotesButton.id = 'widget-map-check-notes-button';
    checkNotesButton.onclick = this.checkNotesCallback;
    container.appendChild(checkNotesButton); */

    /* const createCardsButton = document.createElement('button');
    createCardsButton.textContent = 'Create Cards';
    createCardsButton.id = 'widget-map-add-cards-button';
    createCardsButton.onclick = this.createCardsCallback;
    container.appendChild(createCardsButton); */

    /* const studyButton = document.createElement('button');
    studyButton.textContent = 'Study Mind Map';
    studyButton.id = 'widget-map-study-button';
    studyButton.onclick = this.studyCallback;
    container.appendChild(studyButton); */

    return container;
  }

  ignoreEvent() {
    return false;
  }
}

class MapSettingsButton extends WidgetType {
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
    const settingsButton = document.createElement('button');
    settingsButton.textContent = 'Settings';
    settingsButton.addClass("widget-map-button");
    settingsButton.id = 'widget-map-settings-button';
    settingsButton.onclick = () => {
      // console.log("creating map settings editor modal");
      new MapSettingsEditorModal(this.app, view, this.match).open();
    };
    return settingsButton;
  }
}

class CheckNotesButton extends WidgetType {
  app: App;
  checkNotesCallback: () => void;

  constructor(app: App, checkNotesCallback: () => void) {
    super();
    this.app = app;
    this.checkNotesCallback = checkNotesCallback;
  }

  toDOM(view: EditorView): HTMLElement {
    const checkNotesButton = document.createElement('button');
    checkNotesButton.textContent = 'Check Notes';
    checkNotesButton.addClass("widget-map-button");
    checkNotesButton.id = 'widget-map-check-notes-button';
    checkNotesButton.onclick = this.checkNotesCallback;
    return checkNotesButton;
  }
}

class CreateCardsButton extends WidgetType {
  app: App;
  createCardsCallback: () => void;

  constructor(app: App, createCardsCallback: () => void) {
    super();
    this.app = app;
    this.createCardsCallback = createCardsCallback;
  }

  toDOM(view: EditorView): HTMLElement {
    const createCardsButton = document.createElement('button');
    createCardsButton.textContent = 'Create Cards';
    createCardsButton.addClass("widget-map-button");
    createCardsButton.id = 'widget-map-add-cards-button';
    createCardsButton.onclick = this.createCardsCallback;
    return createCardsButton;
  }
}

class StudyButton extends WidgetType {
  app: App;
  studyCallback: () => void;

  constructor(app: App, studyCallback: () => void) {
    super();
    this.app = app;
    this.studyCallback = studyCallback;
  }

  toDOM(view: EditorView): HTMLElement {
    const studyButton = document.createElement('button');
    studyButton.textContent = 'Study Mind Map';
    studyButton.addClass("widget-map-button");
    studyButton.id = 'widget-map-study-button';
    studyButton.onclick = this.studyCallback;
    return studyButton;
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
      new NotePropertyEditorModal(this.app, view, this.match).open();
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

const mapTagOpenLength = mapTagOpen.length;
const mapTagCloseLength = mapTagClose.length;
// const noteTagOpenLength = noteTagOpen.length;
// const noteTagCloseLength = noteTagClose.length;
export function createMindMapEditorViewPlugin(plugin: Plugin, checkNotesCallback: () => void, createCardsCallback: () => void, studyCallback: () => void) {
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

          let noteMatch;
          const noteRegex = RegExp(notePattern, 'dgm');
          // find every match in the full text
          while ((noteMatch = noteRegex.exec(text)) !== null) {
            // check for card
            const indices = (noteMatch as any).indices;
            indices.forEach((pair: number[], i: number, array: number[][]) => 
              array[i] = [pair[0] + from, pair[1] + from]);

            const start = indices[4][0] - cardTagOpen.length;
            const end = indices[4][1] + cardTagClose.length;

            const deco = Decoration.replace({
              widget: new NoteDataWidget(plugin.app, noteMatch),
              inclusive: false
            });
            decorations.push({ start, end, deco });
          }
          
          let mapMatch;
          const mapTagRegex = RegExp(mapTagPattern, 'dgm');
          while ((mapMatch = mapTagRegex.exec(text)) !== null) {
            const indices = (mapMatch as any).indices;
            indices[0] = [indices[0][0] + from, indices[0][1] + from];
            const deco = Decoration.replace({
              widget: new ControlPanel(plugin.app, mapMatch, checkNotesCallback, createCardsCallback, studyCallback),
              inclusive: false
            });
            decorations.push({ start: indices[0][0], end: indices[0][1], deco});
            decorations.push({ start: indices[0][1], end: indices[0][1], deco: Decoration.widget({ widget: new MapSettingsButton(plugin.app, mapMatch) })})
            decorations.push({ start: indices[0][1], end: indices[0][1], deco: Decoration.widget({ widget: new CheckNotesButton(plugin.app, checkNotesCallback) })})
            decorations.push({ start: indices[0][1], end: indices[0][1], deco: Decoration.widget({ widget: new CreateCardsButton(plugin.app, createCardsCallback) })})
            decorations.push({ start: indices[0][1], end: indices[0][1], deco: Decoration.widget({ widget: new StudyButton(plugin.app, studyCallback) })})
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
