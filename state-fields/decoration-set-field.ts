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


export const decorationSetField = StateField.define<DecorationSet>({
  create(state): DecorationSet {
    return Decoration.none;
  },
  update(oldState: DecorationSet, transaction: Transaction): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();

    const tree = syntaxTree(transaction.state);
    tree.iterate({
      enter(node) {
        if (node.type.name.startsWith('list')) {
          const from = node.from - 2;
          const level = getListItemLevel(transaction.newDoc, from);
          const emoji = getEmojiForLevel(level);
          builder.add(from, from + 1, Decoration.replace({
            widget: new EmojiWidget(emoji),
            inclusive: true,
          }));
        }
      }
    });

    // 

    return builder.finish();
  },
  provide(field: StateField<DecorationSet>): Extension {
    return EditorView.decorations.from(field);
  },
});

function isListItem(text: string): boolean {
  return /^\s*[-+*]/.test(text);
}

function getListItemLevel(doc: Text, pos: number): number {
  let level = 0;
  for (let i = pos; i > 0; i--) {
    const line = doc.lineAt(i);
    if (line.text.trim() === "") continue;
    if (/^\s*[-+*]/.test(line.text)) level++;
    if (!/^\s/.test(line.text)) break;
  }
  return level;
}

function getEmojiForLevel(level: number): string {
  switch (level) {
    case 1: return '🌟';
    case 2: return '⭐';
    case 3: return '✨';
    default: return '🔹';
  }
}

class EmojiWidget extends WidgetType {
  constructor(readonly emoji: string) {
    super();
  }
  toDOM() {
    const span = document.createElement("span");
    span.textContent = this.emoji;
    return span;
  }
  eq(other: EmojiWidget) {
    return other.emoji === this.emoji;
  }
}

class RootNodeWidget extends WidgetType {
  toDOM(view: EditorView): HTMLElement {
    const div = document.createElement('span');

    div.innerText = '$';

    return div;
  }
}

class BranchNodeWidget extends WidgetType {
  toDOM(view: EditorView): HTMLElement {
    const div = document.createElement('span');

    div.innerText = '└───•';

    return div;
  }
}