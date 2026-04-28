import Document from "@tiptap/extension-document";
import History from "@tiptap/extension-history";
import Paragraph from "@tiptap/extension-paragraph";
import Placeholder from "@tiptap/extension-placeholder";
import { Text as TiptapText } from "@tiptap/extension-text";
import { useEditor, type Editor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  PARAGRAPH_OFFSET,
  applyAcceptToEditor,
  buildDocument,
  readEditorContext,
} from "./editorDocument";
import { FilterHighlight } from "./filterHighlight";
import { getSuggestionState } from "./getSuggestionState";
import { handleKey } from "./handleKey";
import {
  CLOSED_SUGGESTION,
  buildSuggestionUI,
  highlightedLabel,
  navigateSuggestion,
  type SuggestionUIState,
} from "./suggestionUI";
import { useLatestRef } from "./useLatestRef";

interface UseFilterEditorParams {
  queryText: string;
  applyQueryText: (text: string) => void;
}

interface FilterEditorApi {
  editor: Editor | null;
  suggestion: SuggestionUIState;
  hasContent: boolean;
  acceptSuggestion: (label: string) => void;
  reset: () => void;
}

export function useFilterEditor({
  queryText,
  applyQueryText,
}: UseFilterEditorParams): FilterEditorApi {
  const [hasContent, setHasContent] = useState(queryText.length > 0);
  const [suggestion, setSuggestion] =
    useState<SuggestionUIState>(CLOSED_SUGGESTION);
  const [dropdownDismissed, setDropdownDismissed] = useState(false);

  const editorRef = useRef<Editor | null>(null);
  const isProgrammaticRef = useRef(false);
  const applyQueryTextRef = useLatestRef(applyQueryText);
  const suggestionRef = useLatestRef(suggestion);
  const dismissedRef = useLatestRef(dropdownDismissed);

  const refreshSuggestion = useCallback(
    (editor: Editor) => {
      const { state } = readEditorContext(editor);
      if (dismissedRef.current && state.open) {
        setSuggestion(CLOSED_SUGGESTION);
        return;
      }
      if (!state.open && dismissedRef.current) {
        setDropdownDismissed(false);
      }
      setSuggestion((prev) =>
        buildSuggestionUI({ state, previousSelected: prev.selectedIndex }),
      );
    },
    [dismissedRef],
  );

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      TiptapText,
      History,
      Placeholder.configure({
        placeholder: "Filter traces… type a field name or free text",
      }),
      FilterHighlight,
    ],
    content: queryText ? buildDocument(queryText) : undefined,
    onUpdate: ({ editor: ed }) => {
      if (isProgrammaticRef.current) return;
      setHasContent(ed.getText().length > 0);
      refreshSuggestion(ed);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      if (isProgrammaticRef.current) return;
      refreshSuggestion(ed);
    },
    onFocus: ({ editor: ed }) => {
      refreshSuggestion(ed);
    },
    onBlur: ({ editor: ed }) => {
      applyQueryTextRef.current(ed.getText().trim());
      setSuggestion(CLOSED_SUGGESTION);
      setDropdownDismissed(false);
    },
    editorProps: {
      attributes: { spellcheck: "false" },
      handleKeyDown: (view, event) => {
        const text = view.state.doc.textContent;
        const cursorPos = view.state.selection.from - PARAGRAPH_OFFSET;
        const liveState = getSuggestionState(text, cursorPos);
        const dismissed = dismissedRef.current;
        const action = handleKey(
          {
            text,
            cursorPos,
            suggestion: dismissed ? { open: false } : liveState,
            highlightedText: dismissed
              ? null
              : highlightedLabel(suggestionRef.current),
          },
          event.key,
        );

        switch (action.kind) {
          case "noop":
            return false;
          case "submit":
            event.preventDefault();
            applyQueryTextRef.current(action.text.trim());
            return true;
          case "blur":
            event.preventDefault();
            (view.dom as HTMLElement).blur();
            return true;
          case "close-dropdown":
            event.preventDefault();
            setDropdownDismissed(true);
            setSuggestion(CLOSED_SUGGESTION);
            return true;
          case "navigate":
            event.preventDefault();
            setSuggestion((prev) =>
              navigateSuggestion({ ui: prev, direction: action.direction }),
            );
            return true;
          case "accept": {
            event.preventDefault();
            const target = editorRef.current;
            if (target) applyAcceptToEditor(target, action);
            return true;
          }
        }
      },
    },
  });

  useEffect(() => {
    editorRef.current = editor ?? null;
  }, [editor]);

  // Sync external query changes back into the editor.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (editor.getText() === queryText) return;
    isProgrammaticRef.current = true;
    editor.commands.setContent(buildDocument(queryText));
    setHasContent(queryText.length > 0);
    isProgrammaticRef.current = false;
  }, [editor, queryText]);

  const acceptSuggestion = useCallback(
    (label: string) => {
      if (!editor) return;
      const current = suggestionRef.current.state;
      if (!current.open) return;
      const { text, cursorPos } = readEditorContext(editor);
      const action = handleKey(
        { text, cursorPos, suggestion: current, highlightedText: label },
        "Enter",
      );
      if (action.kind === "accept") applyAcceptToEditor(editor, action);
    },
    [editor, suggestionRef],
  );

  const reset = useCallback(() => {
    editor?.commands.clearContent();
    setHasContent(false);
    setSuggestion(CLOSED_SUGGESTION);
    setDropdownDismissed(false);
  }, [editor]);

  return { editor, suggestion, hasContent, acceptSuggestion, reset };
}
