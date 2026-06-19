import { syntaxTree } from '@codemirror/language';
import {
  Extension,
  RangeSetBuilder,
  StateField,
  Transaction,
  EditorState,
  Text,
  StateEffect,
} from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view';
import { listItemRegex, mapTagRegex, parseMapTag, parseNote } from 'helpers';
import { Card, FSRSParameters } from 'ts-fsrs';
import { ListItem, MapSettings, Note } from 'types';

export interface MapState {
  valid: boolean;
  map?: MapSettings;
  notes?: Note[];
  tree?: number[][];
}

export const updateEffect = StateEffect.define();

export const map = StateField.define<MapState>({
  create(state): MapState {
    return { valid: false };
  },
  update(oldState: MapState, transaction: Transaction): MapState {
    let newState = oldState;

    if (transaction.docChanged || transaction.effects.some(effect => effect.is(updateEffect))) {
      console.log("updating map state");
      const doc = transaction.newDoc;

      let map = false;
      const notes: Note[] = [];
      const lines: number[] = []; 
      const levels: number[] = [];
      let l = 1;
      for (let line of doc.iterLines()) {
        if (!map) {
          const mapMatch = mapTagRegex.exec(line);
          if (mapMatch) {
            newState.map = parseMapTag(mapMatch[1]);
            map = true;
          }
        }

        const listItemMatch = listItemRegex.exec(line);
        if (listItemMatch) {
          notes.push(parseNote(listItemMatch));
          lines.push(l);
          levels.push(listItemMatch[1].length);
        }
        
        l++;
      }
      if (!map || notes.length == 0) {
        newState.valid = false;
      } else {
        newState.notes = notes;
        newState.tree = noteTree(lines, levels, []);
        newState.valid = true;
      }
      // console.log(newState);
    }

    return newState;
  },
});

function noteTree(lines: number[], levels: number[], path: number[]): number[][] {
  // get indices of lines of immediate children
    const notesAtCurrentLevel: number[] = [];
    for (let i = 0; i < lines.length; i++) { // iterate over each entry
      if (levels[i] == path.length) {
        notesAtCurrentLevel.push(i); // add index of immediate child
        // console.log(notes[i], i);
      }
    }
    notesAtCurrentLevel.push(lines.length);
  
    // iterate over immediate children
    let paths: number[][] = []; // path accumulator
    for (let index = 0; index < notesAtCurrentLevel.length - 1; index++) {
      const i = notesAtCurrentLevel[index];
      let self = lines[i]
      let newPath = path.concat(self);
      paths.push(newPath);
      let start = i + 1; 
      let end = notesAtCurrentLevel[index + 1];
      paths.push(...noteTree(lines.slice(start, end), levels.slice(start, end), newPath));
    }
  
    return paths;
}