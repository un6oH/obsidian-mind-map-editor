import { syntaxTree } from '@codemirror/language';
import {
  Extension,
  RangeSetBuilder,
  StateField,
  Transaction,
  EditorState,
  Text,
} from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view';
import { Card, FSRSParameters } from 'ts-fsrs';

interface MapData {
  title: string, 
  parameters: FSRSParameters, 
}

interface MapElement {
  position: number, // position in the document
  level: number, // list hierarchy level
  content: string, // content of card in raw markdown
  path: string, // full path / deck id of node
  card: Card | null, 
}

interface MapElements {
  elements: MapElement[]
}

export const mapStateField = StateField.define<MapElements>({
  create(state): MapElements {
    return { elements: [] };
  },
  update(oldState: MapElements, transaction: Transaction): MapElements {
    let newState = oldState;

    return newState;
  },
});