import { EditorState, StateField, Transaction } from "@codemirror/state";

export const editorField = StateField.define<number>({
  create(state: EditorState): number {
    return 0;
  },
  update(oldState: number, transaction: Transaction): number {
    let newState = oldState;
    if (transaction.docChanged) {
      if (transaction.changes) {
        console.log(transaction.newDoc);
        newState += 1;
      }
    }
    return newState;
  }
});