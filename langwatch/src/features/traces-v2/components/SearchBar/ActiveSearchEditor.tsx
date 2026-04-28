import { EditorContent } from "@tiptap/react";
import type React from "react";
import { useEffect, useRef } from "react";
import { SuggestionDropdown } from "./SuggestionDropdown";
import { useDynamicValueSuggestions } from "./useDynamicValueSuggestions";
import { useFilterEditor } from "./useFilterEditor";
import { useGlobalSlashFocus } from "./useGlobalSlashFocus";

interface ActiveSearchEditorProps {
  queryText: string;
  applyQueryText: (text: string) => void;
  /** Focus the editor as soon as it mounts. */
  autoFocus: boolean;
  /** Bubble up `hasContent` so the parent can swap the Clear/Kbd affordance. */
  onHasContentChange: (hasContent: boolean) => void;
}

/**
 * Owns the TipTap editor instance. Split out from SearchBar so it can be
 * lazy-mounted — mounting ProseMirror costs ~270ms of forced reflow on cold
 * load, which dominated LCP before this split.
 */
export const ActiveSearchEditor: React.FC<ActiveSearchEditorProps> = ({
  queryText,
  applyQueryText,
  autoFocus,
  onHasContentChange,
}) => {
  const {
    editor,
    suggestion,
    hasContent,
    acceptSuggestion,
    overrideSuggestionItems,
    cursorAnchorX,
  } = useFilterEditor({ queryText, applyQueryText });

  useGlobalSlashFocus(editor);

  useDynamicValueSuggestions({
    state: suggestion.state,
    override: overrideSuggestionItems,
  });

  const focusedRef = useRef(false);
  useEffect(() => {
    if (!autoFocus || !editor || focusedRef.current) return;
    editor.commands.focus();
    focusedRef.current = true;
  }, [autoFocus, editor]);

  useEffect(() => {
    onHasContentChange(hasContent);
  }, [hasContent, onHasContentChange]);

  return (
    <>
      <EditorContent editor={editor} />
      <SuggestionDropdown
        ui={suggestion}
        onSelect={acceptSuggestion}
        anchorX={cursorAnchorX}
      />
    </>
  );
};
