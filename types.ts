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
  id: string | null; // id of node if linked to another branch. node defaults to path if null
  listIndex: number; // number in list. 0 if unordered list
  study: boolean; // whether the node can be studied
  card: Card | null; // null if the node is not studyable
}

export interface Note {
  content: string; // full content in markdown
  props: NoteProperties; 
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
  EmptyLine, Invalid, DuplicateRelation, DuplicateKeyWord, LinkConflict
}