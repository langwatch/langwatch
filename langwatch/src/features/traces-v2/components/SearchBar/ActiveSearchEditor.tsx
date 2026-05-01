import { EditorContent } from "@tiptap/react";
import type React from "react";
import { useEffect, useRef } from "react";
import { SuggestionDropdown } from "./SuggestionDropdown";
import { useFilterEditor, type ValueResolver } from "./useFilterEditor";
import { useGlobalSlashFocus } from "./useGlobalSlashFocus";

interface ActiveSearchEditorProps {
  queryText: string;
  applyQueryText: (text: string) => void;
  /** Focus the editor as soon as it mounts. */
  autoFocus: boolean;
  /** Bubble up `hasContent` so the parent can swap the Clear/Kbd affordance. */
  onHasContentChange: (hasContent: boolean) => void;
  /** Synchronous resolver for dynamic value suggestions (model, service, …). */
  valueResolver?: ValueResolver;
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
  valueResolver,
}) => {
  const { editor, suggestion, acceptSuggestion, cursorAnchorX } =
    useFilterEditor({
      queryText,
      applyQueryText,
      onHasContentChange,
      valueResolver,
    });

  useGlobalSlashFocus(editor);

  const focusedRef = useRef(false);
  useEffect(() => {
    if (!autoFocus || !editor || focusedRef.current) return;
    editor.commands.focus();
    focusedRef.current = true;
  }, [autoFocus, editor]);

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
