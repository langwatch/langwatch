import type { SuggestionState } from "@langwatch/trace-browser-kit";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";

import type { KeyAction } from "../../../../model/handle-key.ts";
import { searchBarSuggestionState } from "../../../../model/search-bar-suggestion-state.ts";

// TipTap wraps text in a paragraph node, so cursor positions in
// `editor.state.selection` are 1-based. Subtract 1 to map back to a string
// offset in `editor.getText()`.
export const PARAGRAPH_OFFSET = 1;

export function buildDocument(text: string) {
  if (!text) {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  };
}

export function readEditorContext(editor: Editor): {
  text: string;
  cursorPos: number;
  state: SuggestionState;
} {
  const text = editor.getText();
  const cursorPos = editor.state.selection.from - PARAGRAPH_OFFSET;
  return { text, cursorPos, state: searchBarSuggestionState(text, cursorPos) };
}

export function applyAcceptToEditor(editor: Editor, action: KeyAction): void {
  if (action.kind !== "accept") return;
  // Bypass TipTap's `insertContent` entirely — it routes through HTML parsing for
  // strings and even text-shaped objects can pick up whitespace normalization (a
  // regular trailing ASCII space gets turned into U+00A0 NBSP).
  const from = action.tokenStart + PARAGRAPH_OFFSET;
  const to = action.tokenEnd + PARAGRAPH_OFFSET;
  const view = editor.view;
  let tr = view.state.tr
    .replaceWith(from, to, view.state.schema.text(action.replacement))
    .scrollIntoView();
  // An accept that opened a pair of quotes leaves the caret between them, so
  // the value is typed inside the chip rather than after it. Zero parks it
  // right after the replacement, past a closing quote stepped over.
  if (action.caretBack !== undefined) {
    const caret = from + action.replacement.length - action.caretBack;
    tr = tr.setSelection(TextSelection.create(tr.doc, caret));
  }
  view.dispatch(tr);
  // Restore focus — `editor.commands.focus()` would do this in the chain
  // version; we call it explicitly so the user can keep typing.
  editor.commands.focus();
}
