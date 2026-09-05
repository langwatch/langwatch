import type { Editor } from "@tiptap/react";
import type { KeyAction, SuggestionState } from "../../../../index";
import { getSuggestionState } from "../../../../index";

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
  return { text, cursorPos, state: getSuggestionState(text, cursorPos) };
}

export function applyAcceptToEditor(editor: Editor, action: KeyAction): void {
  if (action.kind !== "accept") return;
  // Bypass TipTap's `insertContent` entirely — it routes through HTML parsing for
  // strings and even text-shaped objects can pick up whitespace normalization (a
  // regular trailing ASCII space gets turned into U+00A0 NBSP).
  const from = action.tokenStart + PARAGRAPH_OFFSET;
  const to = action.tokenEnd + PARAGRAPH_OFFSET;
  const view = editor.view;
  const tr = view.state.tr
    .replaceWith(from, to, view.state.schema.text(action.replacement))
    .scrollIntoView();
  view.dispatch(tr);
  // Restore focus — `editor.commands.focus()` would do this in the chain
  // version; we call it explicitly so the user can keep typing.
  editor.commands.focus();
}
