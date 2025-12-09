import { FSRSParameters, Card, generatorParameters } from "ts-fsrs";

export interface MapProperties {
  title: string; 
  id: string;
  settings: MapSettings;
}

export interface MapSettings {
  separateHeadings: boolean;
  crosslink: boolean;
  studySettings: FSRSParameters;
}

export interface NoteProperties {
  path: string[]; // all parents
  study: boolean; // whether the node can be studied
  card: Card | null; // null if the node is not studyable
}

export interface Note {
  listIndex: number; // number in list. 0 if unordered list
  content: string; // full content in markdown
  type: 'key word' | 'relation' | 'image';
  id: string | null; // "" if empty, null to force unlink
  props: NoteProperties; 
}

// stores content, index, and level of every instance of the same content
// ref stores the index of the lowest level (reference) instance
export interface NoteGroup {
	content: string | undefined; // undefined if there is a conflict
	id: string; // #<id> or ""
	indices: number[]; // index in note library
	levels: number[]; 
	// parentIndex: number | null; // for duplicate relations under the same parent
	ref: number;
}

export interface MindMap {
  map: MapProperties; 
  notes: Note[];
}
export function createMindMap(): MindMap {
  return {
    map: {
      title: "", 
      id: "", 
      settings: {
        separateHeadings: false, 
        crosslink: true, 
        studySettings: generatorParameters()
      }
    },
    notes: []
  }
}

export interface Settings {
  layouts: MindMapLayout[];
}

export interface MindMapLayout {
  path: string;
  ids: string[];
  xCoords: number[];
  yCoords: number[];
}

export enum Warning {
  EmptyLine, Invalid, DuplicateRelation, DuplicateKeyWord, LinkConflict, LinkConflictReference, ContentNotDefined, ContentConflict
}