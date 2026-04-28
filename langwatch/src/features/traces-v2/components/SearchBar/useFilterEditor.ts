import Document from "@tiptap/extension-document";
import History from "@tiptap/extension-history";
import Paragraph from "@tiptap/extension-paragraph";
import Placeholder from "@tiptap/extension-placeholder";
import { Text as TiptapText } from "@tiptap/extension-text";
import { type Editor, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { removeNodeAtLocation } from "~/server/app-layer/traces/query-language/queryParser";
import {
  applyAcceptToEditor,
  buildDocument,
  PARAGRAPH_OFFSET,
  readEditorContext,
} from "./editorDocument";
import { FilterHighlight } from "./filterHighlight";
import { getSuggestionState, type SuggestionState } from "./getSuggestionState";
import { handleKey } from "./handleKey";
import {
  buildSuggestionUI,
  CLOSED_SUGGESTION,
  highlightedLabel,
  navigateSuggestion,
  type SuggestionUIState,
} from "./suggestionUI";
import { useLatestRef } from "./useLatestRef";

const TRIGGER_TERMINATOR_REGEX = /[ \t\n()]/;
const TRIGGER_PRECEDERS = new Set([" ", "\t", "\n", "("]);

/**
 * When a trigger anchor is set (`@` was intercepted at this position),
 * derive the suggestion state from the segment after the anchor instead of
 * scanning the whole text. This lets us drive the dropdown without ever
 * inserting a literal `@` into the editor.
 */
function suggestionFromTrigger(
  text: string,
  cursorPos: number,
  trigger: number,
): SuggestionState | null {
  if (cursorPos < trigger) return null;
  const segment = text.slice(trigger, cursorPos);
  if (TRIGGER_TERMINATOR_REGEX.test(segment)) return null;
  const colonIdx = segment.indexOf(":");
  if (colonIdx >= 0) {
    const field = segment.slice(0, colonIdx);
    const query = segment.slice(colonIdx + 1);
    if (!field) return { open: false };
    if (query.includes('"')) return { open: false };
    return { open: true, mode: "value", field, query, tokenStart: trigger };
  }
  return { open: true, mode: "field", query: segment, tokenStart: trigger };
}

interface UseFilterEditorParams {
  queryText: string;
  applyQueryText: (text: string) => void;
}

export interface DynamicSuggestionItems {
  items: string[];
  counts?: Record<string, number>;
}

interface FilterEditorApi {
  editor: Editor | null;
  suggestion: SuggestionUIState;
  hasContent: boolean;
  acceptSuggestion: (label: string) => void;
  reset: () => void;
  /**
   * Replace the dropdown's items with a freshly-fetched list (e.g. DB-backed
   * value suggestions for `model:`). Pass `null` to revert to the static
   * items computed from `FIELD_VALUES`.
   */
  overrideSuggestionItems: (next: DynamicSuggestionItems | null) => void;
  /**
   * Horizontal offset (px) from the search bar's left edge to the cursor's
   * current screen position. Drives the dropdown's anchor so it sits under
   * the active token, not back at column 0.
   */
  cursorAnchorX: number;
}

export function useFilterEditor({
  queryText,
  applyQueryText,
}: UseFilterEditorParams): FilterEditorApi {
  const [hasContent, setHasContent] = useState(queryText.length > 0);
  const [suggestion, setSuggestion] =
    useState<SuggestionUIState>(CLOSED_SUGGESTION);
  const [dropdownDismissed, setDropdownDismissed] = useState(false);
  const [cursorAnchorX, setCursorAnchorX] = useState(0);

  const editorRef = useRef<Editor | null>(null);
  const isProgrammaticRef = useRef(false);
  const triggerPosRef = useRef<number | null>(null);
  const applyQueryTextRef = useLatestRef(applyQueryText);
  const suggestionRef = useLatestRef(suggestion);
  const dismissedRef = useLatestRef(dropdownDismissed);
  // Defer `applyQueryText` to the next animation frame so the keystroke
  // handler returns immediately. Coalesces multiple keystrokes that land
  // in the same frame into one parse+serialize pass.
  const pendingCommitRef = useRef<number | null>(null);
  const lastCommittedTextRef = useRef<string>("");
  const scheduleCommit = useCallback(
    (text: string) => {
      if (pendingCommitRef.current !== null) return;
      pendingCommitRef.current = requestAnimationFrame(() => {
        pendingCommitRef.current = null;
        // Read the current editor text rather than the captured one — typing
        // while a frame is queued may have produced more characters.
        const fresh = editorRef.current?.getText() ?? text;
        if (fresh === lastCommittedTextRef.current) return;
        lastCommittedTextRef.current = fresh;
        applyQueryTextRef.current(fresh);
      });
    },
    [applyQueryTextRef],
  );
  // Cancel any pending commit on unmount so we don't write stale text.
  useEffect(
    () => () => {
      if (pendingCommitRef.current !== null) {
        cancelAnimationFrame(pendingCommitRef.current);
      }
    },
    [],
  );

  const refreshSuggestion = useCallback(
    (editor: Editor) => {
      const text = editor.getText();
      const cursorPos = editor.state.selection.from - PARAGRAPH_OFFSET;
      const trigger = triggerPosRef.current;

      let state: SuggestionState;
      if (trigger !== null) {
        const fromTrigger = suggestionFromTrigger(text, cursorPos, trigger);
        if (fromTrigger === null) {
          triggerPosRef.current = null;
          state = getSuggestionState(text, cursorPos);
        } else {
          state = fromTrigger;
        }
      } else {
        state = getSuggestionState(text, cursorPos);
      }

      // Cursor screen position drives the dropdown anchor. Only measure
      // when the dropdown is actually open — `coordsAtPos` forces layout
      // and isn't worth running when nothing's going to render.
      if (state.open) {
        try {
          const view = editor.view;
          const editorRect = view.dom.getBoundingClientRect();
          const coords = view.coordsAtPos(editor.state.selection.from);
          setCursorAnchorX(coords.left - editorRect.left);
        } catch {
          // coordsAtPos can throw if the doc isn't yet mounted; ignore.
        }
      }

      // Escape is sticky for the session — `dismissedRef` only clears on
      // blur, reset, or a fresh `@` trigger.
      if (dismissedRef.current && state.open) {
        setSuggestion(CLOSED_SUGGESTION);
        return;
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
        placeholder: "Search filters, free text, or Ask AI…",
      }),
      FilterHighlight,
    ],
    content: queryText ? buildDocument(queryText) : undefined,
    onUpdate: ({ editor: ed }) => {
      if (isProgrammaticRef.current) return;
      setHasContent(ed.getText().length > 0);
      refreshSuggestion(ed);
      // Live-commit, but deferred via rAF so the keystroke handler returns
      // before liqe runs. Multiple keystrokes in one frame coalesce into a
      // single parse+serialize pass. The sync effect below tolerates NBSP/
      // trim differences so the editor's trailing NBSP isn't clobbered.
      scheduleCommit(ed.getText());
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
      triggerPosRef.current = null;
    },
    editorProps: {
      attributes: { spellcheck: "false" },
      handleKeyDown: (view, event) => {
        const text = view.state.doc.textContent;
        const cursorPos = view.state.selection.from - PARAGRAPH_OFFSET;

        // `@` is a virtual trigger: it never enters the document. We anchor
        // the autocomplete to the cursor position and let subsequent typing
        // grow the active token. If the cursor isn't at a clean token start,
        // auto-insert a space so the new clause doesn't glue onto the
        // previous one.
        if (event.key === "@") {
          event.preventDefault();
          const target = editorRef.current;
          if (!target) return true;
          // `@` is the explicit "force open" — it bypasses any sticky-Escape
          // dismissal so the user can always re-arm the dropdown.
          setDropdownDismissed(false);
          const prev = cursorPos === 0 ? undefined : text[cursorPos - 1];
          const isCleanStart =
            prev === undefined || TRIGGER_PRECEDERS.has(prev);
          if (isCleanStart) {
            triggerPosRef.current = cursorPos;
            refreshSuggestion(target);
          } else {
            triggerPosRef.current = cursorPos + 1;
            target.commands.insertContent(" ");
            // insertContent fires onUpdate -> refreshSuggestion automatically.
          }
          return true;
        }

        const trigger = triggerPosRef.current;
        const triggerState =
          trigger !== null
            ? suggestionFromTrigger(text, cursorPos, trigger)
            : null;
        const liveState = triggerState ?? getSuggestionState(text, cursorPos);
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
            triggerPosRef.current = null;
            applyQueryTextRef.current(action.text.trim());
            return true;
          case "blur":
            event.preventDefault();
            triggerPosRef.current = null;
            (view.dom as HTMLElement).blur();
            return true;
          case "close-dropdown":
            event.preventDefault();
            triggerPosRef.current = null;
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

  // Per-token X button: ProseMirror widgets in `filterHighlight` carry
  // `data-filter-delete` plus the liqe location. We delegate the click on
  // the editor's content element rather than wiring a callback per widget
  // (cheaper to mount, easier to keep refs fresh).
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const dom = editor.view.dom;
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const btn = target?.closest("[data-filter-delete]") as HTMLElement | null;
      if (!btn) return;
      event.preventDefault();
      event.stopPropagation();
      const start = Number(btn.dataset.locStart);
      const end = Number(btn.dataset.locEnd);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return;
      const next = removeNodeAtLocation(editor.getText(), start, end);
      // Update the editor directly — the sync effect skips while focused
      // (so it doesn't race with typing), so a delete from a still-focused
      // editor would otherwise leave the visible content stale until blur.
      isProgrammaticRef.current = true;
      editor.commands.setContent(buildDocument(next));
      isProgrammaticRef.current = false;
      lastCommittedTextRef.current = next;
      applyQueryTextRef.current(next);
    };
    dom.addEventListener("mousedown", handler);
    return () => dom.removeEventListener("mousedown", handler);
  }, [editor, applyQueryTextRef]);

  // Sync external query changes back into the editor. Only runs while the
  // editor is NOT focused — while focused, the editor is the source of
  // truth and clobbering its content (via setContent) would race with
  // in-flight typing and drop characters. When the store changes from
  // outside (URL load, clear button, X-widget delete), the editor is
  // unfocused or the call is paired with a re-mount.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (editor.isFocused) return;
    const normalize = (s: string): string => s.replace(/\u00A0/g, " ").trim();
    if (normalize(editor.getText()) === normalize(queryText)) return;
    isProgrammaticRef.current = true;
    editor.commands.setContent(buildDocument(queryText));
    setHasContent(queryText.length > 0);
    triggerPosRef.current = null;
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
    triggerPosRef.current = null;
  }, [editor]);

  const overrideSuggestionItems = useCallback(
    (next: DynamicSuggestionItems | null) => {
      setSuggestion((prev) => {
        if (!prev.state.open) return prev;
        if (next === null) {
          return buildSuggestionUI({
            state: prev.state,
            previousSelected: prev.selectedIndex,
          });
        }
        const selectedIndex =
          next.items.length === 0
            ? 0
            : Math.min(prev.selectedIndex, next.items.length - 1);
        return {
          ...prev,
          items: next.items,
          itemCounts: next.counts,
          selectedIndex,
        };
      });
    },
    [],
  );

  return {
    editor,
    suggestion,
    hasContent,
    acceptSuggestion,
    reset,
    overrideSuggestionItems,
    cursorAnchorX,
  };
}
