import { FSRSParameters, Card } from "ts-fsrs";

export interface MapProperties {
  title: string, 
  id: string;
  studySettings: FSRSParameters, 
}

export interface NoteProperties {
  path: string[], // all parents
  id: string | null, // id of node if linked to another branch. node defaults to path if null
  study: boolean, // whether the node can be studied
  card: Card | null, // null if the node is not studyable
}

export interface Note {
  content: string, // full content in markdown
  props: NoteProperties, 
}

export interface MindMap {
  map: MapProperties, 
  notes: Note[], 
}