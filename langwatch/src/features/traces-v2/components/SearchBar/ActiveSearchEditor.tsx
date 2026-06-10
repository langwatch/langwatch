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
  /** Forwarded to useFilterEditor — fires when an existing chip is clicked. */
  onTokenClick?: (payload: {
    rect: DOMRect;
    field: string;
    currentValue: string;
    location: { start: number; end: number };
  }) => void;
  /**
   * Fired on ⌘+⏎ / Ctrl+⏎. Carries the editor's current plain-text
   * content so the parent can punt it into AI mode as the seed prompt.
   */
  onAiShortcut?: (currentText: string) => void;
  /**
   * Bubbles up whether the autocomplete dropdown is currently open. The
   * SearchBar uses this to hide the inline "Press ⏎ to search…" hint
   * while the user is mid-autocomplete (the hint would otherwise sit
   * behind / next to the dropdown).
   */
  onSuggestionOpenChange?: (open: boolean) => void;
  /**
   * Bubbles up the cursor's pixel offset from the editor's left edge.
   * The SearchBar renders an inline "Press ⏎ to search…" hint pinned
   * to this offset so the hint floats just after whatever the user
   * has typed, no matter how long it is.
   */
  onCursorAnchorChange?: (anchorX: number) => void;
  /** Mirrors the editor's focus state so the parent can gate chrome. */
  onFocusChange?: (focused: boolean) => void;
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
  onTokenClick,
  onAiShortcut,
  onSuggestionOpenChange,
  onCursorAnchorChange,
  onFocusChange,
}) => {
  const {
    editor,
    suggestion,
    acceptSuggestion,
    cursorAnchorX,
    endAnchorX,
    isFocused,
  } = useFilterEditor({
      queryText,
      applyQueryText,
      onHasContentChange,
      valueResolver,
      onTokenClick,
      onAiShortcut,
    });

  useGlobalSlashFocus(editor);

  const focusedRef = useRef(false);
  useEffect(() => {
    if (!autoFocus || !editor || focusedRef.current) return;
    editor.commands.focus();
    focusedRef.current = true;
  }, [autoFocus, editor]);

  // Bubble suggestion open state up — the parent uses it to hide the
  // inline AI-search hint while autocomplete is active. Mirrors the
  // dropdown's own `open` check in SuggestionDropdown so the hint and
  // dropdown never overlap.
  useEffect(() => {
    if (!onSuggestionOpenChange) return;
    onSuggestionOpenChange(suggestion.state.open && suggestion.items.length > 0);
  }, [suggestion.state.open, suggestion.items.length, onSuggestionOpenChange]);

  useEffect(() => {
    // Forward the *end-of-content* anchor (not the cursor) so the
    // inline submit hint stays pinned to the right of whatever's been
    // typed regardless of caret moves or selection.
    onCursorAnchorChange?.(endAnchorX);
  }, [endAnchorX, onCursorAnchorChange]);

  useEffect(() => {
    onFocusChange?.(isFocused);
  }, [isFocused, onFocusChange]);

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
