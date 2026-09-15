import Document from "@tiptap/extension-document";
import History from "@tiptap/extension-history";
import Paragraph from "@tiptap/extension-paragraph";
import Placeholder from "@tiptap/extension-placeholder";
import { Text as TiptapText } from "@tiptap/extension-text";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { type Editor, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { removeNodeAtLocation, swapOperatorAtLocation } from "@langwatch/trace-contract";
import { AutoUppercaseOperators } from "./auto-uppercase-operators.ts";
import {
  applyAcceptToEditor,
  buildDocument,
  PARAGRAPH_OFFSET,
  readEditorContext,
} from "./editor-document.ts";
import { FilterHighlight } from "../../../../behavior/explorer/search-bar/filter-highlight.ts";
import type { SuggestionState } from "../../../../model/get-suggestion-state.ts";
import { useLatestRef } from "../../../../behavior/use-latest-ref.ts";
import { getSuggestionState } from "../../../../model/get-suggestion-state.ts";
import { handleKey } from "../../../../model/handle-key.ts";
import { searchBarPlaceholder } from "./placeholder-editor.tsx";

/** The chip sub-controls a click may land on inside the filter editor. */
const FILTER_CHIP_CONTROL_SELECTORS = [
  "[data-filter-chip-start]",
  "[data-filter-delete]",
  "[data-filter-op-start]",
] as const;
import {
  buildSuggestionUI,
  CLOSED_SUGGESTION,
  highlightedRow,
  navigateSuggestion,
  type SuggestionUIState,
} from "./suggestion-ui.ts";

const TRIGGER_TERMINATOR_REGEX = /[ \t\n()]/;
const TRIGGER_PRECEDERS = new Set([" ", "\t", "\n", "("]);

// Upper bound on what a single paste can insert into the editor. Picked
// to match the AI prompt input cap (2000) — anything longer is almost
// certainly an accidental log dump rather than a real filter, and lets
// the bar grow tall enough to push the page around even with the CSS
// height cap as a safety net.
const PASTE_MAX_CHARS = 2000;

// How long to wait after the last keystroke before pushing the typed text
// into the global filter store (which re-renders the sidebar + chips and
// arms the network debounce). Keeps fluent typing entirely local to the
// editor; the rest of the page catches up once the user pauses.
const COMMIT_SETTLE_MS = 250;

/**
 * Removes `[start, end)` from `text` and any operator glue left behind, for when the X widget
 * must work even while the parser is failing (where `removeNodeAtLocation` would no-op).
 */
function sliceFallbackTokenRange(text: string, start: number, end: number): string {
  if (start < 0 || end > text.length || start >= end) return text;
  const before = text.slice(0, start).replace(/\s+(AND|OR)\s*$/i, "");
  const after = text.slice(end).replace(/^\s*(AND|OR)\s+/i, "");
  const joined = (before + " " + after).replace(/\s{2,}/g, " ").trim();
  return joined;
}

function suggestionRowsEqual(
  a: { value: string; isPrefix?: boolean },
  b: { value: string; isPrefix?: boolean },
): boolean {
  return a.value === b.value && !!a.isPrefix === !!b.isPrefix;
}

function suggestionRowArraysEqual(
  a: ReadonlyArray<{ value: string; isPrefix?: boolean }>,
  b: ReadonlyArray<{ value: string; isPrefix?: boolean }>,
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!suggestionRowsEqual(a[i]!, b[i]!)) return false;
  }
  return true;
}

function suggestionStateEqual(a: SuggestionState, b: SuggestionState): boolean {
  if (a === b) return true;
  if (!a.open || !b.open) return a.open === b.open;
  if (a.mode !== b.mode) return false;
  if (a.query !== b.query || a.tokenStart !== b.tokenStart) return false;
  if (a.mode === "value" && b.mode === "value" && a.field !== b.field) {
    return false;
  }
  return true;
}

function suggestionUIEqual(a: SuggestionUIState, b: SuggestionUIState): boolean {
  if (a === b) return true;
  if (a.selectedIndex !== b.selectedIndex) return false;
  if (a.itemCounts !== b.itemCounts) return false;
  if (!suggestionStateEqual(a.state, b.state)) return false;
  return suggestionRowArraysEqual(a.items, b.items);
}

/**
 * When a trigger anchor is set (`@` was intercepted at this position), derive the
 * suggestion state from the segment after the anchor instead of scanning the whole
 * text.
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

export interface DynamicSuggestionItems {
  items: string[];
  counts?: Record<string, number>;
  /**
   * Optional human-readable labels keyed by value id.
   */
  labels?: Record<string, string>;
}

export type ValueResolver = (field: string, query: string) => DynamicSuggestionItems | null;

interface UseFilterEditorParams {
  queryText: string;
  applyQueryText: (text: string) => void;
  /**
   * Notifies the parent when the editor's empty/non-empty state flips. Wired through
   * directly instead of via a return value + parent effect so the parent's setState
   * doesn't cause an extra re-render of the editor each keystroke.
   */
  onHasContentChange?: (hasContent: boolean) => void;
  /**
   * Synchronously resolves dynamic value suggestions for `field:` autocomplete (e.g.
   * `model:`, `service:`).
   */
  valueResolver?: ValueResolver;
  /**
   * Fired when the user clicks an existing categorical chip in the search bar. Caller
   * decides whether to render a value-picker popover; if undefined, chip clicks behave
   * like normal text clicks (cursor placement).
   */
  onTokenClick?: (payload: {
    rect: DOMRect;
    field: string;
    currentValue: string;
    location: { start: number; end: number };
  }) => void;
  /**
   * Fired when the user presses ⌘+⏎ / Ctrl+⏎ while typing.
   */
  onAiShortcut?: (currentText: string) => void;
  /**
   * Placeholder shown while the editor is empty. Defaults to the Ask AI wording; the
   * SearchBar passes the Ask Langy variant when Langy owns the ask affordance.
   */
  placeholder?: string;
}

interface FilterEditorApi {
  editor: Editor | null;
  suggestion: SuggestionUIState;
  acceptSuggestion: (label: string) => void;
  reset: () => void;
  /**
   * Horizontal offset (px) from the search bar's left edge to the cursor's
   * current screen position. Drives the dropdown's anchor so it sits under
   * the active token, not back at column 0.
   */
  cursorAnchorX: number;
  /**
   * Pixel offset to the right edge of the rendered document content.
   */
  endAnchorX: number;
  /** Whether the editor currently holds focus. */
  isFocused: boolean;
}

export function useFilterEditor({
  queryText,
  applyQueryText,
  onHasContentChange,
  valueResolver,
  onTokenClick,
  onAiShortcut,
  placeholder,
}: UseFilterEditorParams): FilterEditorApi {
  const [suggestion, setSuggestion] = useState<SuggestionUIState>(CLOSED_SUGGESTION);
  const [dropdownDismissed, setDropdownDismissed] = useState(false);
  const [cursorAnchorX, setCursorAnchorX] = useState(0);
  // Independent anchor that tracks the *end of the rendered content*,
  // not the cursor — drives the inline submit hint so a ⌘+A or
  // mid-text caret placement doesn't drag the hint on top of the
  // user's text. Always updated (regardless of dropdown state).
  const [endAnchorX, setEndAnchorX] = useState(0);
  // TipTap's `editor.isFocused` doesn't trigger React renders. Mirror
  // focus/blur into state so the SearchBar can hide chrome (inline
  // submit hint, …) when the editor isn't actively engaged.
  const [isFocused, setIsFocused] = useState(false);

  const editorRef = useRef<Editor | null>(null);
  const isProgrammaticRef = useRef(false);
  const triggerPosRef = useRef<number | null>(null);
  const applyQueryTextRef = useLatestRef(applyQueryText);
  const onHasContentChangeRef = useLatestRef(onHasContentChange);
  const suggestionRef = useLatestRef(suggestion);
  const dismissedRef = useLatestRef(dropdownDismissed);
  const valueResolverRef = useLatestRef(valueResolver);
  const onAiShortcutRef = useLatestRef(onAiShortcut);
  // Read by the Placeholder extension through a function, so the label keeps
  // up with the caller (Ask AI ↔ Ask Langy) without re-initialising TipTap.
  const placeholderRef = useLatestRef(placeholder ?? searchBarPlaceholder("Ask AI"));
  // Tracks last reported hasContent so we only fire onHasContentChange when
  // it actually flips (not on every keystroke that keeps the state).
  const lastHasContentRef = useRef<boolean>(queryText.length > 0);
  // Committing the typed text into the GLOBAL filter store (`applyQueryText`) re-parses
  // + re-serialises AND re-renders every store subscriber — the whole facet sidebar,
  // the query-breakdown chips, the page title, the URL sync.
  const pendingCommitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommittedTextRef = useRef<string>("");
  const scheduleCommit = useCallback(
    () => armCommitTimer({ applyQueryTextRef, editorRef, lastCommittedTextRef, pendingCommitRef }),
    [applyQueryTextRef],
  );
  // Cancel any pending commit on unmount so we don't write stale text.
  useEffect(() => () => cancelPendingCommit(pendingCommitRef), []);

  const refreshSuggestion = useCallback(
    (editor: Editor, prereadText?: string) =>
      refreshSuggestionUI({
        dismissedRef,
        editor,
        prereadText,
        setCursorAnchorX,
        setEndAnchorX,
        setSuggestion,
        triggerPosRef,
        valueResolverRef,
      }),
    [dismissedRef, valueResolverRef],
  );

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      TiptapText,
      History,
      Placeholder.configure({
        placeholder: () => placeholderRef.current ?? "",
      }),
      FilterHighlight,
      AutoUppercaseOperators,
    ],
    content: queryText ? buildDocument(queryText) : undefined,
    onUpdate: ({ editor: ed }) => {
      if (isProgrammaticRef.current) return;
      const text = ed.getText();
      reportHasContent({ hasContent: text.length > 0, lastHasContentRef, onHasContentChangeRef });
      refreshSuggestion(ed, text);
      // Live-commit, but deferred so the keystroke handler returns before liqe
      // runs: multiple keystrokes coalesce into one parse+serialize pass. The
      // sync effect tolerates NBSP/trim differences so the editor's trailing
      // NBSP isn't clobbered.
      scheduleCommit();
    },
    onSelectionUpdate: ({ editor: ed }) => {
      if (isProgrammaticRef.current) return;
      refreshSuggestion(ed);
    },
    onFocus: ({ editor: ed }) => {
      setIsFocused(true);
      refreshSuggestion(ed);
    },
    onBlur: ({ editor: ed }) => {
      setIsFocused(false);
      // Blur is an authoritative settle — flush the typed text now and drop
      // any pending debounced commit so it can't fire a stale follow-up.
      cancelPendingCommit(pendingCommitRef);
      const finalText = ed.getText().trim();
      lastCommittedTextRef.current = finalText;
      applyQueryTextRef.current(finalText);
      setSuggestion(CLOSED_SUGGESTION);
      setDropdownDismissed(false);
      triggerPosRef.current = null;
    },
    editorProps: {
      attributes: { spellcheck: "false" },
      // Coerce paste into one flat line. The editor's schema technically allows
      // multiple Paragraph nodes, so pasting a multi-line error creates 10+ `<p>`s and
      // balloons the bar to push the rest of the page off-screen.
      handlePaste: (view, event) => flattenPasteIntoEditor(view, event),
      // Suppress PM's default cursor placement when the user clicks on a chip pill or
      // its X widget.
      handleDOMEvents: {
        mousedown: (_view, event) => isChipControlTarget(event.target),
      },
      // Clicking in the editor's empty trailing area (the big blank space to the right
      // of the last chip) used to drop the caret INSIDE the final chip's text node — so
      // the next character glued onto the chip's value (`status:okx`).
      handleClick: (view, _pos, event) => moveCaretToEndOnVoidClick(view, event),
      handleKeyDown: (view, event) =>
        handleEditorKeyDown({
          applyQueryTextRef,
          dismissedRef,
          editorRef,
          event,
          isProgrammaticRef,
          onAiShortcutRef,
          pendingCommitRef,
          lastCommittedTextRef,
          refreshSuggestion,
          setDropdownDismissed,
          setSuggestion,
          suggestionRef,
          triggerPosRef,
          view,
        }),
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
    const handler = (event: MouseEvent) =>
      handleEditorMouseDown({
        applyQueryTextRef,
        editor,
        event,
        isProgrammaticRef,
        lastCommittedTextRef,
        onTokenClick,
      });
    dom.addEventListener("mousedown", handler);
    return () => dom.removeEventListener("mousedown", handler);
  }, [editor, applyQueryTextRef, onTokenClick]);

  // Sync external query changes back into the editor. Only runs while the editor is NOT
  // focused — while focused, the editor is the source of truth and clobbering its
  // content (via setContent) would race with in-flight typing and drop characters.
  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.isFocused) return;
    if (editorTextMatches(editor, queryText)) return;
    isProgrammaticRef.current = true;
    editor.commands.setContent(buildDocument(queryText));
    reportHasContent({
      hasContent: queryText.length > 0,
      lastHasContentRef,
      onHasContentChangeRef,
    });
    triggerPosRef.current = null;
    isProgrammaticRef.current = false;
  }, [editor, queryText, onHasContentChangeRef]);

  const acceptSuggestion = useCallback(
    (label: string) => acceptSuggestionLabel({ editor, label, suggestionRef }),
    [editor, suggestionRef],
  );

  const reset = useCallback(() => {
    editor?.commands.clearContent();
    reportHasContent({ hasContent: false, lastHasContentRef, onHasContentChangeRef });
    setSuggestion(CLOSED_SUGGESTION);
    setDropdownDismissed(false);
    triggerPosRef.current = null;
  }, [editor, onHasContentChangeRef]);

  return {
    editor,
    suggestion,
    acceptSuggestion,
    reset,
    cursorAnchorX,
    endAnchorX,
    isFocused,
  };
}

/** The screen x of a document position, relative to the editor, rounded to whole
 *  pixels so sub-pixel jitter doesn't trigger re-renders. Null when the document
 *  isn't mounted yet and `coordsAtPos` throws; the next refresh recovers. */
function anchorXAt(editor: Editor, pos: number): number | null {
  try {
    const view = editor.view;
    const editorRect = view.dom.getBoundingClientRect();
    const coords = view.coordsAtPos(pos);
    return Math.round(coords.left - editorRect.left);
  } catch {
    return null;
  }
}

/** The suggestion state for the caret, honouring an active `@` trigger. */
function suggestionStateFor({
  cursorPos,
  text,
  triggerPosRef,
}: {
  cursorPos: number;
  text: string;
  triggerPosRef: { current: number | null };
}): SuggestionState {
  const trigger = triggerPosRef.current;
  if (trigger === null) return getSuggestionState(text, cursorPos);
  const fromTrigger = suggestionFromTrigger(text, cursorPos, trigger);
  if (fromTrigger !== null) return fromTrigger;
  triggerPosRef.current = null;
  return getSuggestionState(text, cursorPos);
}

/**
 * For value-mode autocomplete on facet-backed fields (model, service, …) the
 * dynamic resolver's output replaces the static items in the same render,
 * rather than through a follow-up effect: one render per keystroke, and no
 * flash of static items.
 */
function nextSuggestionUI({
  prev,
  state,
  valueResolver,
}: {
  prev: SuggestionUIState;
  state: SuggestionState;
  valueResolver: UseFilterEditorParams["valueResolver"];
}): SuggestionUIState {
  const base = buildSuggestionUI({ state, previousSelected: prev.selectedIndex });
  if (!base.state.open || base.state.mode !== "value" || !valueResolver) return base;
  // Capture the field here, where the `mode === "value"` narrowing still holds —
  // it is lost inside the `.map` closure below.
  const valueField = base.state.field;
  const dynamic = valueResolver(valueField, base.state.query);
  if (!dynamic || dynamic.items.length === 0) return base;
  // Dynamic value-mode rows have no group (values aren't grouped) and aren't
  // prefix entries — wrap the bare strings into the SuggestionRow shape the
  // dropdown renderer expects.
  return {
    state: base.state,
    items: dynamic.items.map((value) => ({
      value,
      label: dynamic.labels?.[value] ?? value,
      field: valueField,
      group: null,
    })),
    itemCounts: dynamic.counts,
    selectedIndex: Math.min(base.selectedIndex, dynamic.items.length - 1),
  };
}

/**
 * Coerce paste into one flat line. The editor's schema technically allows
 * multiple Paragraph nodes, so pasting a multi-line error creates 10+ `<p>`s and
 * balloons the bar to push the rest of the page off-screen.
 */
function flattenPasteIntoEditor(view: EditorView, event: ClipboardEvent): boolean {
  const text = event.clipboardData?.getData("text/plain");
  if (!text) return false;
  const flattened = text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    .slice(0, PASTE_MAX_CHARS);
  if (flattened === text) return false;
  event.preventDefault();
  view.dispatch(view.state.tr.insertText(flattened));
  return true;
}

/** Whether the click landed on a chip pill or one of its widgets. */
function isChipControlTarget(eventTarget: EventTarget | null): boolean {
  const target = eventTarget as HTMLElement | null;
  if (!target) return false;
  return FILTER_CHIP_CONTROL_SELECTORS.some((selector) => target.closest(selector) !== null);
}

/**
 * Clicking the editor's empty trailing area used to drop the caret INSIDE the
 * final chip's text node, so the next character glued onto the chip's value
 * (`status:okx`). Put it after the content instead.
 */
function moveCaretToEndOnVoidClick(view: EditorView, event: MouseEvent): boolean {
  const endPos = view.state.doc.content.size;
  let endCoords: { left: number; right: number };
  try {
    endCoords = view.coordsAtPos(endPos);
  } catch {
    return false;
  }
  // A few px of slack so a click right at the content's edge still
  // counts as "on the content", not the trailing void.
  if (event.clientX <= endCoords.right + 2) return false;
  const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, endPos));
  view.dispatch(tr);
  view.focus();
  return true;
}

/** Drops a pending debounced commit so it can't fire a stale follow-up. */
function cancelPendingCommit(pendingCommitRef: { current: ReturnType<typeof setTimeout> | null }) {
  if (pendingCommitRef.current === null) return;
  clearTimeout(pendingCommitRef.current);
  pendingCommitRef.current = null;
}

interface EditorKeyContext {
  applyQueryTextRef: { current: (text: string) => void };
  dismissedRef: { current: boolean };
  editorRef: { current: Editor | null };
  isProgrammaticRef: { current: boolean };
  lastCommittedTextRef: { current: string };
  onAiShortcutRef: { current: ((seed: string) => void) | undefined };
  pendingCommitRef: { current: ReturnType<typeof setTimeout> | null };
  refreshSuggestion: (editor: Editor, prereadText?: string) => void;
  setDropdownDismissed: (dismissed: boolean) => void;
  setSuggestion: (
    update: SuggestionUIState | ((prev: SuggestionUIState) => SuggestionUIState),
  ) => void;
  suggestionRef: { current: SuggestionUIState };
  triggerPosRef: { current: number | null };
}

/**
 * `@` is a virtual trigger: it never enters the document. The autocomplete is
 * anchored to the cursor position and subsequent typing grows the active token.
 * When the cursor isn't at a clean token start a space is inserted first, so the
 * new clause doesn't glue onto the previous one.
 */
function openTriggerAtCursor({
  ctx,
  cursorPos,
  text,
}: {
  ctx: EditorKeyContext;
  cursorPos: number;
  text: string;
}): void {
  const target = ctx.editorRef.current;
  if (!target) return;
  // `@` is the explicit "force open" — it bypasses any sticky-Escape
  // dismissal so the user can always re-arm the dropdown.
  ctx.setDropdownDismissed(false);
  const prev = cursorPos === 0 ? undefined : text[cursorPos - 1];
  if (prev === undefined || TRIGGER_PRECEDERS.has(prev)) {
    ctx.triggerPosRef.current = cursorPos;
    ctx.refreshSuggestion(target);
    return;
  }
  ctx.triggerPosRef.current = cursorPos + 1;
  target.commands.insertContent(" ");
  // insertContent fires onUpdate -> refreshSuggestion automatically.
}

/**
 * Commits the typed text and opens a fresh clause, so the next keystroke starts
 * a NEW token instead of gluing onto the just-completed one (`status:ok` + `x` →
 * `status:okx`, the "cursor stuck inside the chip" report).
 */
function submitAndOpenNewClause({
  ctx,
  text,
  view,
}: {
  ctx: EditorKeyContext;
  text: string;
  view: EditorView;
}): void {
  ctx.triggerPosRef.current = null;
  // Apply immediately and cancel any pending debounced commit so the
  // settle timer doesn't fire a redundant second apply afterward.
  cancelPendingCommit(ctx.pendingCommitRef);
  const committed = text.trim();
  ctx.lastCommittedTextRef.current = committed;
  ctx.applyQueryTextRef.current(committed);
  ctx.isProgrammaticRef.current = true;
  let submitTr = view.state.tr.setSelection(TextSelection.atEnd(view.state.doc));
  const endsWithSpace = /\s$/.test(view.state.doc.textContent);
  if (!endsWithSpace) {
    submitTr = submitTr.insertText("\u00A0");
  }
  view.dispatch(submitTr.scrollIntoView());
  ctx.isProgrammaticRef.current = false;
}

/** Carries out the action the key table decided on. */
function applyKeyAction({
  action,
  ctx,
  event,
  view,
}: {
  action: ReturnType<typeof handleKey>;
  ctx: EditorKeyContext;
  event: KeyboardEvent;
  view: EditorView;
}): boolean {
  if (action.kind === "noop") return false;
  event.preventDefault();
  if (action.kind === "submit") {
    submitAndOpenNewClause({ ctx, text: action.text, view });
    return true;
  }
  if (action.kind === "blur") {
    ctx.triggerPosRef.current = null;
    (view.dom as HTMLElement).blur();
    return true;
  }
  if (action.kind === "close-dropdown") {
    ctx.triggerPosRef.current = null;
    ctx.setDropdownDismissed(true);
    ctx.setSuggestion(CLOSED_SUGGESTION);
    return true;
  }
  if (action.kind === "navigate") {
    ctx.setSuggestion((prev) => navigateSuggestion({ ui: prev, direction: action.direction }));
    return true;
  }
  const target = ctx.editorRef.current;
  if (target) applyAcceptToEditor(target, action);
  return true;
}

/** Every key the filter editor answers to, in the order it answers them. */
function handleEditorKeyDown({
  event,
  view,
  ...ctx
}: EditorKeyContext & { event: KeyboardEvent; view: EditorView }): boolean {
  const text = view.state.doc.textContent;
  const cursorPos = view.state.selection.from - PARAGRAPH_OFFSET;

  // ⌘+⏎ / Ctrl+⏎ → punt the current text into Ask AI, before any of the
  // autocomplete or submit logic runs, so a held modifier always wins. Without
  // content the shortcut still opens AI mode, with an empty seed.
  const isModEnter = event.key === "Enter" && (event.metaKey || event.ctrlKey);
  if (isModEnter && ctx.onAiShortcutRef.current) {
    event.preventDefault();
    ctx.onAiShortcutRef.current(text);
    return true;
  }

  if (event.key === "@") {
    event.preventDefault();
    openTriggerAtCursor({ ctx, cursorPos, text });
    return true;
  }

  const trigger = ctx.triggerPosRef.current;
  const triggerState = trigger !== null ? suggestionFromTrigger(text, cursorPos, trigger) : null;
  const liveState = triggerState ?? getSuggestionState(text, cursorPos);
  const dismissed = ctx.dismissedRef.current;
  const highlighted = dismissed ? null : highlightedRow(ctx.suggestionRef.current);
  const action = handleKey(
    {
      text,
      cursorPos,
      suggestion: dismissed ? { open: false } : liveState,
      highlightedText: highlighted?.value ?? null,
      highlightedIsPrefix: highlighted?.isPrefix,
    },
    event.key,
  );

  return applyKeyAction({ action, ctx, event, view });
}

/**
 * Committing the typed text into the global filter store re-parses, re-serialises
 * and re-renders every subscriber, so it waits for the typing to settle.
 */
function armCommitTimer({
  applyQueryTextRef,
  editorRef,
  lastCommittedTextRef,
  pendingCommitRef,
}: {
  applyQueryTextRef: { current: (text: string) => void };
  editorRef: { current: Editor | null };
  lastCommittedTextRef: { current: string };
  pendingCommitRef: { current: ReturnType<typeof setTimeout> | null };
}): void {
  cancelPendingCommit(pendingCommitRef);
  pendingCommitRef.current = setTimeout(() => {
    pendingCommitRef.current = null;
    // Read the current editor text rather than the captured one — typing
    // after the timer armed will have produced more characters.
    const fresh = editorRef.current?.getText() ?? "";
    if (fresh === lastCommittedTextRef.current) return;
    lastCommittedTextRef.current = fresh;
    applyQueryTextRef.current(fresh);
  }, COMMIT_SETTLE_MS);
}

/**
 * Tells the caller about content only when it actually flips, not on every
 * keystroke that keeps the state.
 */
function reportHasContent({
  hasContent,
  lastHasContentRef,
  onHasContentChangeRef,
}: {
  hasContent: boolean;
  lastHasContentRef: { current: boolean };
  onHasContentChangeRef: { current: ((hasContent: boolean) => void) | undefined };
}): void {
  if (lastHasContentRef.current === hasContent) return;
  lastHasContentRef.current = hasContent;
  onHasContentChangeRef.current?.(hasContent);
}

/** Whether the editor already reads as the query, NBSP and trimming aside. */
function editorTextMatches(editor: Editor, queryText: string): boolean {
  const normalize = (value: string): string => value.replace(/\u00A0/g, " ").trim();
  return normalize(editor.getText()) === normalize(queryText);
}

/** Accepts a suggestion the reader clicked, as if they had pressed Enter on it. */
function acceptSuggestionLabel({
  editor,
  label,
  suggestionRef,
}: {
  editor: Editor | null;
  label: string;
  suggestionRef: { current: SuggestionUIState };
}): void {
  if (!editor) return;
  const current = suggestionRef.current.state;
  if (!current.open) return;
  const { text, cursorPos } = readEditorContext(editor);
  // Look up whether the clicked label corresponds to a prefix row so
  // the accept handler doesn't auto-append `:` to `trace.attribute.`.
  const matched = suggestionRef.current.items.find((r) => r.value === label);
  const action = handleKey(
    {
      text,
      cursorPos,
      suggestion: current,
      highlightedText: label,
      highlightedIsPrefix: matched?.isPrefix,
    },
    "Enter",
  );
  if (action.kind === "accept") applyAcceptToEditor(editor, action);
}

/** The liqe-text coordinates a decoration carries, when it carries a usable pair. */
function locationOf(
  element: HTMLElement,
  startKey: string,
  endKey: string,
): { start: number; end: number } | null {
  const start = Number(element.dataset[startKey]);
  const end = Number(element.dataset[endKey]);
  const hasLocation = Number.isFinite(start) && Number.isFinite(end);
  if (!hasLocation) return null;
  return { start, end };
}

interface EditorMouseContext {
  applyQueryTextRef: { current: (text: string) => void };
  editor: Editor;
  isProgrammaticRef: { current: boolean };
  lastCommittedTextRef: { current: string };
}

/**
 * Replaces the editor's content directly. The sync effect skips while focused so
 * it doesn't race with typing, which would otherwise leave a chip edit from a
 * still-focused editor stale on screen until blur.
 */
function replaceEditorQuery(ctx: EditorMouseContext, next: string): void {
  ctx.isProgrammaticRef.current = true;
  ctx.editor.commands.setContent(buildDocument(next));
  ctx.isProgrammaticRef.current = false;
  ctx.lastCommittedTextRef.current = next;
  ctx.applyQueryTextRef.current(next);
}

/**
 * Chip click → open the value-picker popover. Chip spans carry field/value/
 * location data attributes from filterHighlight's decoration pass; the parent
 * receives the click rect to anchor the popover.
 */
function openChipPicker({
  chipEl,
  onTokenClick,
}: {
  chipEl: HTMLElement;
  onTokenClick: NonNullable<UseFilterEditorParams["onTokenClick"]>;
}): void {
  const location = locationOf(chipEl, "filterChipStart", "filterChipEnd");
  const field = chipEl.dataset.filterChipField ?? "";
  const value = chipEl.dataset.filterChipValue ?? "";
  if (!location || !field || !value) return;
  onTokenClick({
    rect: chipEl.getBoundingClientRect(),
    field,
    currentValue: value,
    location,
  });
}

/**
 * AND/OR operator click → cycle the keyword in place, from the liqe-text
 * coordinates on the span, without re-parsing the AST here.
 */
function cycleOperatorAt(ctx: EditorMouseContext, opEl: HTMLElement): void {
  const location = locationOf(opEl, "filterOpStart", "filterOpEnd");
  if (!location) return;
  const current = ctx.editor.getText();
  const next = swapOperatorAtLocation({ currentQuery: current, ...location });
  if (next === current) return;
  replaceEditorQuery(ctx, next);
}

/**
 * X widget click → drop the token. AST-path widgets ride on liqe's trimmed-text
 * locations; fallback-path widgets only exist while the parser is failing, so
 * there the matched range is sliced out of the raw text and any AND/OR glue is
 * tidied up.
 */
function deleteTokenAt(ctx: EditorMouseContext, btn: HTMLElement): void {
  const location = locationOf(btn, "locStart", "locEnd");
  if (!location) return;
  const current = ctx.editor.getText();
  const next =
    btn.dataset.kind === "fallback"
      ? sliceFallbackTokenRange(current, location.start, location.end)
      : removeNodeAtLocation({ currentQuery: current, ...location });
  replaceEditorQuery(ctx, next);
}

/**
 * One delegated mousedown on the editor's content element: a chip, an operator,
 * or a token's X widget. Delegation keeps the widgets cheap to mount and the
 * refs fresh.
 */
function handleEditorMouseDown({
  event,
  onTokenClick,
  ...ctx
}: EditorMouseContext & {
  event: MouseEvent;
  onTokenClick: UseFilterEditorParams["onTokenClick"];
}): void {
  // The editor may be destroyed between mount and this firing (StrictMode
  // double-effect, fast unmount); calling getText/setContent on a destroyed
  // view crashes ProseMirror.
  if (ctx.editor.isDestroyed) return;
  const target = event.target as HTMLElement | null;

  const chipEl = target?.closest("[data-filter-chip-start]") as HTMLElement | null;
  // Skip when no callback is wired so chip clicks still place the cursor.
  if (chipEl && onTokenClick) {
    event.preventDefault();
    event.stopPropagation();
    openChipPicker({ chipEl, onTokenClick });
    return;
  }

  const opEl = target?.closest("[data-filter-op-start]") as HTMLElement | null;
  if (opEl) {
    event.preventDefault();
    event.stopPropagation();
    cycleOperatorAt(ctx, opEl);
    return;
  }

  const btn = target?.closest("[data-filter-delete]") as HTMLElement | null;
  if (!btn) return;
  event.preventDefault();
  event.stopPropagation();
  deleteTokenAt(ctx, btn);
}

/**
 * Recomputes the dropdown for the current caret: its state, the two screen
 * anchors it is positioned by, and the rows it offers.
 */
function refreshSuggestionUI({
  dismissedRef,
  editor,
  prereadText,
  setCursorAnchorX,
  setEndAnchorX,
  setSuggestion,
  triggerPosRef,
  valueResolverRef,
}: {
  dismissedRef: { current: boolean };
  editor: Editor;
  prereadText: string | undefined;
  setCursorAnchorX: (update: (prev: number) => number) => void;
  setEndAnchorX: (update: (prev: number) => number) => void;
  setSuggestion: (
    update: SuggestionUIState | ((prev: SuggestionUIState) => SuggestionUIState),
  ) => void;
  triggerPosRef: { current: number | null };
  valueResolverRef: { current: UseFilterEditorParams["valueResolver"] };
}): void {
  const text = prereadText ?? editor.getText();
  const cursorPos = editor.state.selection.from - PARAGRAPH_OFFSET;
  const state = suggestionStateFor({ cursorPos, text, triggerPosRef });

  updateSuggestionAnchors({
    editor,
    isOpen: state.open,
    setCursorAnchorX,
    setEndAnchorX,
    textLength: text.length,
  });

  // Escape is sticky for the session — `dismissedRef` only clears on blur,
  // reset, or a fresh `@` trigger.
  if (dismissedRef.current && state.open) {
    setSuggestion((prev) => (prev === CLOSED_SUGGESTION ? prev : CLOSED_SUGGESTION));
    return;
  }
  setSuggestion((prev) => {
    const next = nextSuggestionUI({ prev, state, valueResolver: valueResolverRef.current });
    return suggestionUIEqual(prev, next) ? prev : next;
  });
}

/**
 * The two screen anchors the dropdown and the inline submit hint hang off. The
 * cursor anchor is only measured while the dropdown is open, since `coordsAtPos`
 * forces layout; the end anchor is independent of the caret so a ⌘+A or a
 * click back into the middle doesn't drag the hint onto the reader's text.
 */
function updateSuggestionAnchors({
  editor,
  isOpen,
  setCursorAnchorX,
  setEndAnchorX,
  textLength,
}: {
  editor: Editor;
  isOpen: boolean;
  setCursorAnchorX: (update: (prev: number) => number) => void;
  setEndAnchorX: (update: (prev: number) => number) => void;
  textLength: number;
}): void {
  const cursorX = isOpen ? anchorXAt(editor, editor.state.selection.from) : null;
  if (cursorX !== null) setCursorAnchorX((prev) => (prev === cursorX ? prev : cursorX));
  const endX = anchorXAt(editor, PARAGRAPH_OFFSET + textLength);
  if (endX !== null) setEndAnchorX((prev) => (prev === endX ? prev : endX));
}
