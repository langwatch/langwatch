import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Extension } from "@tiptap/react";
import { PARAGRAPH_OFFSET } from "./editor-document.ts";

// Auto-uppercase `and`/`or`/`not` when the user types a separator after
// them. Skips bulk paste, quoted strings, and bracketed ranges.

const OPERATOR_TRIGGER = /(?:^|[\s(])(and|or|not)$/;
const SEPARATOR_REGEX = /[\s()]/;

function isInsideQuoted(text: string, pos: number): boolean {
  let count = 0;
  for (let i = 0; i < pos; i++) {
    if (text[i] === '"') count++;
  }
  return count % 2 === 1;
}

function isInsideBrackets(text: string, pos: number): boolean {
  let depth = 0;
  for (let i = 0; i < pos; i++) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]") depth--;
  }
  return depth > 0;
}

export const AutoUppercaseOperators = Extension.create({
  name: "autoUppercaseOperators",
  addProseMirrorPlugins() {
    const key = new PluginKey("autoUppercaseOperators");
    return [
      new Plugin({
        key,
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const edit = operatorEdit(oldState.doc.textContent, newState.doc.textContent);
          if (!edit) return null;
          return newState.tr.insertText(edit.word.toUpperCase(), edit.from, edit.to);
        },
      }),
    ];
  },
});

/**
 * The operator the keystroke just closed off, as a document range, or null when
 * the edit was not a single separator typed after a bare `and` / `or` / `not`.
 */
function operatorEdit(
  oldText: string,
  newText: string,
): { word: string; from: number; to: number } | null {
  if (newText.length !== oldText.length + 1) return null;
  // Skip pathological docs — `isInsideQuoted`/`isInsideBrackets`
  // are O(n) and we don't want to amplify that on every keystroke.
  if (newText.length > 5_000) return null;

  let diffAt = 0;
  while (diffAt < oldText.length && oldText[diffAt] === newText[diffAt]) {
    diffAt += 1;
  }
  const inserted = newText[diffAt];
  if (!inserted || !SEPARATOR_REGEX.test(inserted)) return null;

  const match = newText.slice(0, diffAt).match(OPERATOR_TRIGGER);
  if (!match) return null;
  const word = match[1] ?? "";
  const wordStart = diffAt - word.length;
  const isQuoted = isInsideQuoted(newText, wordStart);
  const isBracketed = isInsideBrackets(newText, wordStart);
  if (isQuoted || isBracketed) return null;

  // PARAGRAPH_OFFSET = 1 for the wrapping paragraph node.
  return { word, from: wordStart + PARAGRAPH_OFFSET, to: diffAt + PARAGRAPH_OFFSET };
}
