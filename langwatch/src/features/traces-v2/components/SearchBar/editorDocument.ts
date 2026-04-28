import type { Editor } from "@tiptap/react";
import { getSuggestionState, type SuggestionState } from "./getSuggestionState";
import type { KeyAction } from "./handleKey";

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
  editor
    .chain()
    .focus()
    .setTextSelection({
      from: action.tokenStart + PARAGRAPH_OFFSET,
      to: action.tokenEnd + PARAGRAPH_OFFSET,
    })
    .insertContent(action.replacement)
    .run();
}
