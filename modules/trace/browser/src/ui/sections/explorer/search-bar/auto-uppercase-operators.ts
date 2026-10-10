import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Extension } from "@tiptap/react";

import { operatorEdit } from "../../../../model/operator-autocase.ts";
import { PARAGRAPH_OFFSET } from "./editor-document.ts";

// Auto-uppercase `and`/`or`/`not` when the user types a separator after
// them. Skips bulk paste, quoted strings, bracketed ranges and sentences.

export const AutoUppercaseOperators = Extension.create({
  name: "autoUppercaseOperators",
  addProseMirrorPlugins() {
    const key = new PluginKey("autoUppercaseOperators");
    return [
      new Plugin({
        key,
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const edit = operatorEdit({
            oldText: oldState.doc.textContent,
            newText: newState.doc.textContent,
          });
          if (!edit) return null;
          return newState.tr.insertText(
            edit.word.toUpperCase(),
            edit.from + PARAGRAPH_OFFSET,
            edit.to + PARAGRAPH_OFFSET,
          );
        },
      }),
    ];
  },
});
