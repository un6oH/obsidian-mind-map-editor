import { syntaxTree } from '@codemirror/language';
import {
  StateEffect,
  StateField,
  Transaction,
} from '@codemirror/state';
import { listItemPattern, listItemRegex, mapTagPattern } from 'helpers';

export interface MindMapTree {
  root: number; // line number of map tag
  parent: number[] // line number of parent of item i. 0 if invalid
}

export const mindMapTreeUpdateEffect = StateEffect.define<MindMapTree>();

export const mindMapTrees = StateField.define<MindMapTree[]>({
  create(state): MindMapTree[] {
    return [];
  },
  update(state: MindMapTree[], transaction: Transaction): MindMapTree[] {
    console.log("mindMapTrees.update()");
    if (!transaction.effects.some(effect => effect.is(mindMapTreeUpdateEffect))) {
      return state;
    }

    console.log("mindMapTrees.update(): creating mind map trees");
    const doc = transaction.state.doc;
    let maps: MindMapTree[] = [];

    let mapTagMatch;
    const mapTagRegex = RegExp(mapTagPattern, 'gm');
    let docString = doc.toString();
    let hasMap = false;
    while((mapTagMatch = mapTagRegex.exec(docString)) !== null) {
      hasMap = true;
      const root = doc.lineAt(mapTagMatch.index).number;
      maps.push({ root, parent: [] })
    }
    let ranges = maps.map(map => map.root);
    ranges.push(doc.lines + 1);

    maps.forEach((map, i) => {
      const root = map.root;
      const hierarchy = [root]; // line numbers of current hierarchy
      let l = root + 1; // line number
      for (let line of doc.iterLines(ranges[i] + 1, ranges[i + 1])) {
        const listItemMatch = listItemRegex.exec(line);
        let tabLevel = 0; // non list item lines default to 0
        if (listItemMatch !== null) {
          const tabLevel = listItemMatch[1].length + 1; // root is at 'level' 0, 1-based index
          hierarchy.splice(tabLevel); // removes items at or above tab level. last item of remaining array is the parent
          map.parent.push(hierarchy.last()!) // add current line's parent to registry
          hierarchy.push(l); // add current line to hierarchy
        } else {
          map.parent.push(0); // 0 if the line does not contain a list item
        }
        l++;
      }
    });

    return maps;
  },
});
