import { removeNodeAtLocation, swapOperatorAtLocation } from "@langwatch/trace-contract";
import Document from "@tiptap/extension-document";
import History from "@tiptap/extension-history";
import Paragraph from "@tiptap/extension-paragraph";
import Placeholder from "@tiptap/extension-placeholder";
import { Text as TiptapText } from "@tiptap/extension-text";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { type Editor, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { FilterHighlight } from "../../../../behavior/explorer/search-bar/filter-highlight.ts";
import { useLatestRef } from "../../../../behavior/use-latest-ref.ts";
import { handleKey } from "../../../../model/handle-key.ts";
import { AutoUppercaseOperators } from "./auto-uppercase-operators.ts";
import {
  applyAcceptToEditor,
  buildDocument,
  PARAGRAPH_OFFSET,
  readEditorContext,
} from "./editor-document.ts";
import { SEARCH_BAR_PLACEHOLDER } from "./placeholder-editor.tsx";

/** The chip sub-controls a click may land on inside the filter editor. */
const FILTER_CHIP_CONTROL_SELECTORS = [
  "[data-filter-chip-start]",
  "[data-filter-delete]",
  "[data-filter-op-start]",
] as const;
import {
  buildSuggestionUI,
  CLOSED_SUGGESTION,
  getSuggestionState,
  highlightedRow,
  navigateSuggestion,
  type SuggestionState,
  type SuggestionUIState,
} from "@langwatch/trace-browser-kit";

const TRIGGER_TERMINATOR_REGEX = /[ \t\n()]/;
const TRIGGER_PRECEDERS = new Set([" ", "\t", "\n", "("]);

// Upper bound on what a single paste can insert into the editor. Picked
// to match the AI prompt input cap (2000) — anything longer is almost
// certainly an accidental log dump rather than a real filter, and lets
// the bar grow tall enough to push the page around even with the CSS
// height cap as a safety net.
const PASTE_MAX_CHARS = 2000;

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
  a: readonly { value: string; isPrefix?: boolean }[],
  b: readonly { value: string; isPrefix?: boolean }[],
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
  /**
   * Applies a query the editor produced by a deliberate edit of an existing
   * chip: the X widget, the AND/OR swap. Those search at once, like a facet
   * click; typing never reaches this.
   */
  applyQueryText: (text: string) => void;
  /**
   * Enter with no highlighted suggestion: the only path a typed text takes out
   * of the editor. Blur is not a submit — the text stays typed and unsearched
   * until Enter. @see ADR-144
   */
  submitQueryText: (text: string) => void;
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
  submitQueryText,
  onHasContentChange,
  valueResolver,
  onTokenClick,
  onAiShortcut,
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
  const submitQueryTextRef = useLatestRef(submitQueryText);
  const onHasContentChangeRef = useLatestRef(onHasContentChange);
  const suggestionRef = useLatestRef(suggestion);
  const dismissedRef = useLatestRef(dropdownDismissed);
  const valueResolverRef = useLatestRef(valueResolver);
  const onAiShortcutRef = useLatestRef(onAiShortcut);
  // Tracks last reported hasContent so we only fire onHasContentChange when
  // it actually flips (not on every keystroke that keeps the state).
  const lastHasContentRef = useRef<boolean>(queryText.length > 0);
  // The text Enter last submitted. While the editor still holds exactly this,
  // the applied query that answers the submit may replace it even though the
  // editor has focus: nothing was typed since, so there is nothing to clobber.
  const submittedTextRef = useRef<string | null>(null);
  // The ProseMirror editor is the source of truth while the user types. The
  // store (the sidebar, the chips, the URL, the network) only hears about the
  // text on Enter, through `submitQueryText`: nothing commits on a timer or on
  // blur, so typing and pausing never search.

  // The end-of-content anchor, measured outside a suggestion refresh: a
  // programmatic replace skips that refresh, and a bar that keeps focus keeps
  // showing the hint, which would otherwise stay where the sentence ended.
  const measureEndAnchor = useCallback(
    (target: Editor, text: string) =>
      setEndAnchorXFor({ editor: target, setEndAnchorX, textLength: text.length }),
    [],
  );

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
      Placeholder.configure({ placeholder: SEARCH_BAR_PLACEHOLDER }),
      FilterHighlight,
      AutoUppercaseOperators,
    ],
    content: queryText ? buildDocument(queryText) : undefined,
    onUpdate: ({ editor: ed }) => {
      if (isProgrammaticRef.current) return;
      const text = ed.getText();
      reportHasContent({ hasContent: text.length > 0, lastHasContentRef, onHasContentChangeRef });
      refreshSuggestion(ed, text);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      if (isProgrammaticRef.current) return;
      refreshSuggestion(ed);
    },
    onFocus: ({ editor: ed }) => {
      setIsFocused(true);
      refreshSuggestion(ed);
    },
    onBlur: () => {
      setIsFocused(false);
      // Blur is not a submit: the typed text stays in the editor, unsearched,
      // until Enter.
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
          dismissedRef,
          editorRef,
          event,
          isProgrammaticRef,
          onAiShortcutRef,
          submitQueryTextRef,
          submittedTextRef,
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
        onTokenClick,
      });
    dom.addEventListener("mousedown", handler);
    return () => dom.removeEventListener("mousedown", handler);
  }, [editor, applyQueryTextRef, onTokenClick]);

  // Sync external query changes back into the editor. A focused editor is the
  // source of truth and setContent would race with in-flight typing, so it is
  // left alone — with one exception: the answer to the user's own Enter, which
  // the router writes a moment later and the bar must show.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    writeExternalQuery({
      editor,
      isProgrammaticRef,
      lastHasContentRef,
      measureEndAnchor,
      onHasContentChangeRef,
      queryText,
      submittedTextRef,
      triggerPosRef,
    });
  }, [editor, queryText, onHasContentChangeRef, measureEndAnchor]);

  const acceptSuggestion = useCallback(
    (label: string) => acceptSuggestionLabel({ editor, label, suggestionRef }),
    [editor, suggestionRef],
  );

  /**
   * Empties the editor on the user's own instruction, whatever the store
   * holds. Clear keeps the caret in the bar, so the sync effect never sees it:
   * text that was never submitted has nothing in the store to change.
   */
  const reset = useCallback(() => {
    if (editor && !editor.isDestroyed) {
      isProgrammaticRef.current = true;
      editor.commands.clearContent();
      isProgrammaticRef.current = false;
    }
    submittedTextRef.current = null;
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
 * For value-mode autocomplete on facet-backed fields, the dynamic
 * resolver's output replaces static items in the same render, not a
 * follow-up effect: one render per keystroke, no flash of static items.
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
  const withoutLineBreaks = text.replace(/[\r\n\t]+/g, " ");
  const flattened = Array.from(withoutLineBreaks)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 8 && (code < 11 || code > 31) && code !== 127;
    })
    .join("")
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

interface EditorKeyContext {
  dismissedRef: { current: boolean };
  editorRef: { current: Editor | null };
  isProgrammaticRef: { current: boolean };
  onAiShortcutRef: { current: ((seed: string) => void) | undefined };
  submitQueryTextRef: { current: (text: string) => void };
  submittedTextRef: { current: string | null };
  refreshSuggestion: (editor: Editor, prereadText?: string) => void;
  setDropdownDismissed: (dismissed: boolean) => void;
  setSuggestion: (
    update: SuggestionUIState | ((prev: SuggestionUIState) => SuggestionUIState),
  ) => void;
  suggestionRef: { current: SuggestionUIState };
  triggerPosRef: { current: number | null };
}

/**
 * `@` is a virtual trigger: it never enters the document. The autocomplete
 * anchors to the cursor and typing grows the token. A space is inserted
 * first when the cursor isn't at a clean start, so clauses don't glue.
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
  const submitted = text.trim();
  ctx.submittedTextRef.current = submitted;
  ctx.submitQueryTextRef.current(submitted);
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

/** Moves the end-of-content anchor, if the editor can be measured at all. */
function setEndAnchorXFor({
  editor,
  setEndAnchorX,
  textLength,
}: {
  editor: Editor;
  setEndAnchorX: (update: (prev: number) => number) => void;
  textLength: number;
}): void {
  const endX = anchorXAt(editor, PARAGRAPH_OFFSET + textLength);
  if (endX === null) return;
  setEndAnchorX((prev) => (prev === endX ? prev : endX));
}

/**
 * Replaces the editor's document with a query applied from outside, when that
 * query wins over what the editor holds.
 */
function writeExternalQuery({
  editor,
  isProgrammaticRef,
  lastHasContentRef,
  measureEndAnchor,
  onHasContentChangeRef,
  queryText,
  submittedTextRef,
  triggerPosRef,
}: {
  editor: Editor;
  isProgrammaticRef: { current: boolean };
  lastHasContentRef: { current: boolean };
  measureEndAnchor: (editor: Editor, text: string) => void;
  onHasContentChangeRef: { current: ((hasContent: boolean) => void) | undefined };
  queryText: string;
  submittedTextRef: { current: string | null };
  triggerPosRef: { current: number | null };
}): void {
  const replaces = externalQueryReplacesEditor({
    editorText: editor.getText(),
    submittedText: submittedTextRef.current,
    queryText,
    isFocused: editor.isFocused,
  });
  if (!replaces) return;
  submittedTextRef.current = null;
  const keepFocus = editor.isFocused;
  isProgrammaticRef.current = true;
  editor.commands.setContent(buildDocument(queryText));
  // `setContent` leaves a selection across the document it wrote, which an
  // unfocused bar paints over its chips: park the caret at the end instead.
  editor.commands.setTextSelection(editor.state.doc.content.size);
  if (keepFocus) editor.commands.focus("end");
  measureEndAnchor(editor, editor.getText());
  reportHasContent({ hasContent: queryText.length > 0, lastHasContentRef, onHasContentChangeRef });
  triggerPosRef.current = null;
  isProgrammaticRef.current = false;
}

/** The editor's text as the query language reads it: NBSP and trimming aside. */
const normalizeEditorText = (text: string): string => text.replace(/\u00A0/g, " ").trim();

/**
 * Whether a query applied from outside replaces what the editor holds. A
 * focused editor keeps its text unless it still holds exactly what the user
 * submitted, which is the router answering their own Enter.
 */
function externalQueryReplacesEditor({
  editorText,
  submittedText,
  queryText,
  isFocused,
}: {
  editorText: string;
  submittedText: string | null;
  queryText: string;
  isFocused: boolean;
}): boolean {
  const current = normalizeEditorText(editorText);
  const answersSubmit = submittedText !== null && current === normalizeEditorText(submittedText);
  if (isFocused && !answersSubmit) return false;
  return current !== normalizeEditorText(queryText);
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
 * X widget click → drop the token. AST-path widgets ride on liqe's
 * trimmed-text locations; fallback-path widgets (parser failing) slice the
 * matched range out of the raw text and tidy up any AND/OR glue.
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
 * The two screen anchors the dropdown and inline submit hint hang off. The
 * cursor anchor is measured only while open (`coordsAtPos` forces layout);
 * the end anchor is caret-independent so a ⌘+A doesn't drag the hint.
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
