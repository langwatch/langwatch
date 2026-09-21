import Document from "@tiptap/extension-document";
import History from "@tiptap/extension-history";
import Paragraph from "@tiptap/extension-paragraph";
import Placeholder from "@tiptap/extension-placeholder";
import { Text as TiptapText } from "@tiptap/extension-text";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import { type Editor, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  removeNodeAtLocation,
  swapOperatorAtLocation,
} from "~/server/app-layer/traces/query-language/mutations";
import { AutoUppercaseOperators } from "./autoUppercaseOperators";
import {
  applyAcceptToEditor,
  buildDocument,
  PARAGRAPH_OFFSET,
  readEditorContext,
} from "./editorDocument";
import { FilterHighlight, LABEL_REFRESH_META } from "./filterHighlight";
import { getSuggestionState, type SuggestionState } from "./getSuggestionState";
import { handleKey } from "./handleKey";
import { SEARCH_BAR_PLACEHOLDER } from "./PlaceholderEditor";
import {
  buildSuggestionUI,
  CLOSED_SUGGESTION,
  highlightedRow,
  navigateSuggestion,
  type SuggestionUIState,
} from "./suggestionUI";
import { useLatestRef } from "./useLatestRef";

const TRIGGER_TERMINATOR_REGEX = /[ \t\n()]/;
const TRIGGER_PRECEDERS = new Set([" ", "\t", "\n", "("]);

// Upper bound on what a single paste can insert into the editor. Picked
// to match the AI prompt input cap (2000) — anything longer is almost
// certainly an accidental log dump rather than a real filter, and lets
// the bar grow tall enough to push the page around even with the CSS
// height cap as a safety net.
const PASTE_MAX_CHARS = 2000;

/**
 * Remove the chars at `[start, end)` from `text` and clean up any operator
 * glue we left behind. Used by the X widget when the parser is currently
 * failing — a normal `removeNodeAtLocation` would no-op there and the X
 * would feel broken. Strips a trailing or leading `AND`/`OR` so we don't
 * end up with `model:gpt AND ` orphaned at the end of the query.
 */
function sliceFallbackTokenRange(
  text: string,
  start: number,
  end: number,
): string {
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

function suggestionUIEqual(
  a: SuggestionUIState,
  b: SuggestionUIState,
): boolean {
  if (a === b) return true;
  if (a.selectedIndex !== b.selectedIndex) return false;
  if (a.itemCounts !== b.itemCounts) return false;
  if (!suggestionStateEqual(a.state, b.state)) return false;
  return suggestionRowArraysEqual(a.items, b.items);
}

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

export interface DynamicSuggestionItems {
  items: string[];
  counts?: Record<string, number>;
  /**
   * Optional human-readable labels keyed by value id. When set, the
   * suggestion dropdown renders the label as the primary text and the
   * id muted underneath; the inserted token is still the raw `value`
   * so the query language stays ID-only (search-by-name is not a goal —
   * the value is the canonical identifier).
   */
  labels?: Record<string, string>;
}

export type ValueResolver = (
  field: string,
  query: string,
) => DynamicSuggestionItems | null;

interface UseFilterEditorParams {
  queryText: string;
  /**
   * Applies a query the editor produced by a deliberate edit of an existing
   * chip: the X widget, the AND/OR swap. Those search at once, like a facet
   * click; typing never reaches this.
   */
  applyQueryText: (text: string) => void;
  /**
   * Enter with no highlighted suggestion. The only path a typed text takes
   * out of the editor: the caller decides whether it is a filter to apply
   * or a sentence to route. Blur is not a submit; the text stays where it
   * was typed, unsearched, until Enter.
   */
  submitQueryText: (text: string) => void;
  /**
   * Notifies the parent when the editor's empty/non-empty state flips. Wired
   * through directly instead of via a return value + parent effect so the
   * parent's setState doesn't cause an extra re-render of the editor each
   * keystroke.
   */
  onHasContentChange?: (hasContent: boolean) => void;
  /**
   * Synchronously resolves dynamic value suggestions for `field:` autocomplete
   * (e.g. `model:`, `service:`). Called inline by `refreshSuggestion` so the
   * dropdown emits a single state update per keystroke — pulling this out of
   * a `useEffect`-based override eliminated a second render per keystroke.
   * Return `null` to fall back to the static `FIELD_VALUES` enum.
   */
  valueResolver?: ValueResolver;
  /**
   * Fired when the user clicks an existing categorical chip in the
   * search bar. Caller decides whether to render a value-picker
   * popover; if undefined, chip clicks behave like normal text clicks
   * (cursor placement).
   */
  onTokenClick?: (payload: {
    rect: DOMRect;
    field: string;
    currentValue: string;
    location: { start: number; end: number };
  }) => void;
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
   * Independent of the cursor — drives the inline "Enter to search" hint
   * so the hint stays pinned to the end of the typed text even when the
   * caret is mid-line or `⌘+A` selected everything.
   */
  endAnchorX: number;
  /** Whether the editor currently holds focus. */
  isFocused: boolean;
}

const normalizeEditorText = (text: string): string =>
  text.replace(/\u00A0/g, " ").trim();

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
  const answersSubmit =
    submittedText !== null && current === normalizeEditorText(submittedText);
  if (isFocused && !answersSubmit) return false;
  return current !== normalizeEditorText(queryText);
}

export function useFilterEditor({
  queryText,
  applyQueryText,
  submitQueryText,
  onHasContentChange,
  valueResolver,
  onTokenClick,
}: UseFilterEditorParams): FilterEditorApi {
  const [suggestion, setSuggestion] =
    useState<SuggestionUIState>(CLOSED_SUGGESTION);
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
  // Tracks last reported hasContent so we only fire onHasContentChange when
  // it actually flips (not on every keystroke that keeps the state).
  const lastHasContentRef = useRef<boolean>(queryText.length > 0);
  // The text Enter last submitted. While the editor still holds exactly this,
  // the applied query that answers the submit may replace it even though the
  // editor has focus: nothing was typed since, so there is nothing to clobber.
  const submittedTextRef = useRef<string | null>(null);
  // The ProseMirror editor is the source of truth while the user types. The
  // global filter store (the sidebar, the chips, the URL, the network) only
  // hears about the text on Enter, through `submitQueryText`. Nothing here
  // commits on a timer or on blur, so typing and pausing never search.

  // End-of-content anchor for the inline submit hint. Independent of the
  // cursor: a ⌘+A or a click back into the middle puts the caret anywhere, but
  // the hint stays pinned right after the text. Measured by asking PM for the
  // coords at the document's end position (PARAGRAPH_OFFSET + text length).
  const measureEndAnchor = useCallback((editor: Editor, text: string) => {
    try {
      const view = editor.view;
      const editorRect = view.dom.getBoundingClientRect();
      const coords = view.coordsAtPos(PARAGRAPH_OFFSET + text.length);
      // A chip with an overlay label paints the label after its text, and
      // its remove button follows it, so the end of the text is not the end
      // of what is drawn. Take whichever reaches further right.
      const lastDrawn = view.dom.firstElementChild?.lastElementChild;
      const drawnRight = lastDrawn?.getBoundingClientRect().right ?? 0;
      const next = Math.round(
        Math.max(coords.left, drawnRight) - editorRect.left,
      );
      setEndAnchorX((prev) => (prev === next ? prev : next));
    } catch {
      // coordsAtPos throws on cold mount; the next refresh will recover.
    }
  }, []);

  const refreshSuggestion = useCallback(
    (editor: Editor, prereadText?: string) => {
      const text = prereadText ?? editor.getText();
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
      // and isn't worth running when nothing's going to render. Round to
      // whole pixels so sub-pixel jitter doesn't trigger re-renders.
      if (state.open) {
        try {
          const view = editor.view;
          const editorRect = view.dom.getBoundingClientRect();
          const coords = view.coordsAtPos(editor.state.selection.from);
          const next = Math.round(coords.left - editorRect.left);
          setCursorAnchorX((prev) => (prev === next ? prev : next));
        } catch {
          // coordsAtPos can throw if the doc isn't yet mounted; ignore.
        }
      }

      measureEndAnchor(editor, text);

      // Escape is sticky for the session — `dismissedRef` only clears on
      // blur, reset, or a fresh `@` trigger.
      if (dismissedRef.current && state.open) {
        setSuggestion((prev) =>
          prev === CLOSED_SUGGESTION ? prev : CLOSED_SUGGESTION,
        );
        return;
      }
      setSuggestion((prev) => {
        const base = buildSuggestionUI({
          state,
          previousSelected: prev.selectedIndex,
        });
        // For value-mode autocomplete on facet-backed fields (model, service,
        // etc.) replace the static items with the dynamic resolver's output
        // here — same render — instead of via a follow-up effect. Avoids a
        // second render per keystroke and the brief flash of static items.
        let next = base;
        if (
          base.state.open &&
          base.state.mode === "value" &&
          valueResolverRef.current
        ) {
          // Capture the field here, where the `mode === "value"` narrowing
          // still holds — it's lost inside the `.map` closure below.
          const valueField = base.state.field;
          const dynamic = valueResolverRef.current(
            valueField,
            base.state.query,
          );
          if (dynamic && dynamic.items.length > 0) {
            const selectedIndex = Math.min(
              base.selectedIndex,
              dynamic.items.length - 1,
            );
            // Dynamic value-mode rows have no group (values aren't grouped)
            // and aren't prefix entries — wrap the bare strings into the
            // SuggestionRow shape that the dropdown renderer expects.
            // `label` carries the human-readable name when the resolver
            // emitted one (evaluator: "Faithfulness" for the id
            // "ragas/faithfulness"); the dropdown renders the label as
            // the primary row and the raw id as a muted secondary line.
            // Without this the dropdown only ever showed ids, which is
            // what the operator was complaining about for evaluators.
            next = {
              state: base.state,
              items: dynamic.items.map((value) => ({
                value,
                label: dynamic.labels?.[value] ?? value,
                field: valueField,
                group: null,
              })),
              itemCounts: dynamic.counts,
              selectedIndex,
            };
          }
        }
        return suggestionUIEqual(prev, next) ? prev : next;
      });
    },
    [dismissedRef, valueResolverRef, measureEndAnchor],
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
      const next = text.length > 0;
      if (lastHasContentRef.current !== next) {
        lastHasContentRef.current = next;
        onHasContentChangeRef.current?.(next);
      }
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
      // Blur is not a submit. The typed text stays in the editor, unsearched,
      // so a click elsewhere on the page never fires a search the user did
      // not ask for. The next Enter takes it, and a store change from outside
      // (a facet click, Clear) replaces it through the sync effect below.
      setSuggestion(CLOSED_SUGGESTION);
      setDropdownDismissed(false);
      triggerPosRef.current = null;
    },
    editorProps: {
      attributes: { spellcheck: "false" },
      // Coerce paste into one flat line. The editor's schema technically
      // allows multiple Paragraph nodes, so pasting a multi-line error
      // creates 10+ `<p>`s and balloons the bar to push the rest of the
      // page off-screen. Strip control chars, collapse newlines + tabs
      // to spaces, and cap the inserted text at PASTE_MAX_CHARS so a
      // megabyte paste can't lock the parser up. The editor's
      // overflow-x scroll still handles wide content.
      handlePaste: (view, event) => {
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
      },
      // Suppress PM's default cursor placement when the user clicks on a
      // chip pill or its X widget. PM otherwise drops the caret into the
      // text node *inside* the chip (between "value" and the widget), so
      // typing the next clause read as if it were extending the chip's
      // value (`status:errorx`). Returning `true` here keeps PM out of
      // the click — the addEventListener-based handler below still runs
      // and opens the value picker / deletes the chip.
      handleDOMEvents: {
        mousedown: (_view, event) => {
          const target = event.target as HTMLElement | null;
          if (!target) return false;
          if (
            target.closest("[data-filter-chip-start]") ||
            target.closest("[data-filter-delete]") ||
            target.closest("[data-filter-op-start]")
          ) {
            return true;
          }
          return false;
        },
      },
      // Clicking in the editor's empty trailing area (the big blank space to
      // the right of the last chip) used to drop the caret INSIDE the final
      // chip's text node — so the next character glued onto the chip's value
      // (`status:okx`). Snap the caret to the very end of the doc instead, so
      // a click in the blank space always starts a fresh clause. Only fires
      // when the click is genuinely past the content's right edge; clicks
      // landing on real text/chips fall through to ProseMirror's default.
      handleClick: (view, _pos, event) => {
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
        const tr = view.state.tr.setSelection(
          TextSelection.create(view.state.doc, endPos),
        );
        view.dispatch(tr);
        view.focus();
        return true;
      },
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
        const highlighted = dismissed
          ? null
          : highlightedRow(suggestionRef.current);
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

        switch (action.kind) {
          case "noop":
            return false;
          case "submit": {
            event.preventDefault();
            triggerPosRef.current = null;
            submittedTextRef.current = action.text.trim();
            submitQueryTextRef.current(action.text.trim());
            // Open a fresh clause so the next keystroke starts a NEW token
            // instead of gluing onto the just-completed one (`status:ok` + `x`
            // → `status:okx`, the "cursor stuck inside the chip" report). This
            // mirrors the dropdown-accept path; the submit path (Enter with no
            // highlighted suggestion) previously left the caret flush against
            // the last token with no boundary. Park the caret at the end and
            // append a boundary char unless the text already ends in
            // whitespace. The char is a NBSP (U+00A0), NOT a regular space:
            // contenteditable/PM eat a trailing regular space the instant the
            // next character arrives (which re-glues the tokens), whereas NBSP
            // survives — the parser normalises it back to a space. Flagged
            // programmatic so onUpdate doesn't re-commit the suffixed text; the
            // editor keeps focus, so the store→editor sync (skipped while
            // focused, trim-normalised anyway) won't clobber the boundary.
            isProgrammaticRef.current = true;
            let submitTr = view.state.tr.setSelection(
              TextSelection.atEnd(view.state.doc),
            );
            if (!/\s$/.test(view.state.doc.textContent)) {
              submitTr = submitTr.insertText("\u00A0");
            }
            view.dispatch(submitTr.scrollIntoView());
            isProgrammaticRef.current = false;
            return true;
          }
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
      // Editor may be destroyed between mount and this firing (StrictMode
      // double-effect, fast unmount); calling getText/setContent on a
      // destroyed view crashes ProseMirror.
      if (editor.isDestroyed) return;
      const target = event.target as HTMLElement | null;

      // Chip click → open the value-picker popover. Chip spans carry
      // field/value/location data attrs from filterHighlight's
      // decoration pass; the parent receives the click rect to anchor
      // the popover. Skip when no callback is wired so chip clicks
      // still place the cursor as before.
      const chipEl = target?.closest(
        "[data-filter-chip-start]",
      ) as HTMLElement | null;
      if (chipEl && onTokenClick) {
        event.preventDefault();
        event.stopPropagation();
        const start = Number(chipEl.dataset.filterChipStart);
        const end = Number(chipEl.dataset.filterChipEnd);
        const field = chipEl.dataset.filterChipField ?? "";
        const value = chipEl.dataset.filterChipValue ?? "";
        if (Number.isFinite(start) && Number.isFinite(end) && field && value) {
          onTokenClick({
            rect: chipEl.getBoundingClientRect(),
            field,
            currentValue: value,
            location: { start, end },
          });
        }
        return;
      }

      // AND/OR operator click → cycle the keyword in place. The inline
      // span carries the liqe-text coordinates as data attributes (set
      // by `filterHighlight`'s decoration pass) so we can flip without
      // re-parsing the AST here.
      const opEl = target?.closest(
        "[data-filter-op-start]",
      ) as HTMLElement | null;
      if (opEl) {
        event.preventDefault();
        event.stopPropagation();
        const start = Number(opEl.dataset.filterOpStart);
        const end = Number(opEl.dataset.filterOpEnd);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return;
        const current = editor.getText();
        const next = swapOperatorAtLocation({
          currentQuery: current,
          start,
          end,
        });
        if (next === current) return;
        isProgrammaticRef.current = true;
        editor.commands.setContent(buildDocument(next));
        isProgrammaticRef.current = false;
        applyQueryTextRef.current(next);
        return;
      }

      const btn = target?.closest("[data-filter-delete]") as HTMLElement | null;
      if (!btn) return;
      event.preventDefault();
      event.stopPropagation();
      const start = Number(btn.dataset.locStart);
      const end = Number(btn.dataset.locEnd);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return;
      const kind = btn.dataset.kind === "fallback" ? "fallback" : "ast";
      const current = editor.getText();
      // AST-path widgets ride on liqe's trimmed-text locations and use
      // `removeNodeAtLocation` to drop the matching node and any orphaned
      // operator parents. Fallback-path widgets only exist while the parser
      // is failing — there's no AST to walk, so we slice the matched range
      // out of the raw text and tidy any AND/OR glue we leave behind.
      const next =
        kind === "ast"
          ? removeNodeAtLocation({ currentQuery: current, start, end })
          : sliceFallbackTokenRange(current, start, end);
      // Update the editor directly — the sync effect skips while focused
      // (so it doesn't race with typing), so a delete from a still-focused
      // editor would otherwise leave the visible content stale until blur.
      isProgrammaticRef.current = true;
      editor.commands.setContent(buildDocument(next));
      isProgrammaticRef.current = false;
      applyQueryTextRef.current(next);
    };
    dom.addEventListener("mousedown", handler);
    return () => dom.removeEventListener("mousedown", handler);
  }, [editor, applyQueryTextRef, onTokenClick]);

  // Sync external query changes back into the editor. While the editor is
  // focused it is the source of truth, and clobbering its content (via
  // setContent) would race with in-flight typing and drop characters, so a
  // focused editor is left alone, with one exception: the answer to the
  // user's own Enter. The router turns a submitted sentence into a query a
  // moment later, the editor still has focus, and the bar must show what was
  // searched. That is safe while the editor holds exactly the submitted text.
  // When the store changes from outside an unfocused editor (URL load, clear
  // button, a facet click), the applied query wins over any unsent text.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
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
    if (keepFocus) editor.commands.focus("end");
    // Programmatic changes skip the refresh that measures the hint's anchor,
    // and a bar that keeps focus keeps showing the hint: measure it here, or
    // the hint stays where the replaced sentence ended, on top of the chips.
    measureEndAnchor(editor, editor.getText());
    const next = queryText.length > 0;
    if (lastHasContentRef.current !== next) {
      lastHasContentRef.current = next;
      onHasContentChangeRef.current?.(next);
    }
    triggerPosRef.current = null;
    isProgrammaticRef.current = false;
  }, [editor, queryText, onHasContentChangeRef, measureEndAnchor]);

  const acceptSuggestion = useCallback(
    (label: string) => {
      if (!editor) return;
      const current = suggestionRef.current.state;
      if (!current.open) return;
      const { text, cursorPos } = readEditorContext(editor);
      // Look up whether the clicked label corresponds to a prefix row so
      // the accept handler doesn't auto-append `:` to `trace.attribute.`.
      const matched = suggestionRef.current.items.find(
        (r) => r.value === label,
      );
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
    },
    [editor, suggestionRef],
  );

  /**
   * Empties the editor on the user's own instruction, whatever the store
   * holds. Clear keeps the caret in the bar, so the sync effect below never
   * sees it: the effect leaves a focused editor alone, and a bar holding text
   * that was never submitted has nothing in the store to change anyway. The
   * clear is applied here for the same reason the X widget applies its own
   * delete here.
   */
  const reset = useCallback(() => {
    if (editor && !editor.isDestroyed) {
      isProgrammaticRef.current = true;
      editor.commands.clearContent();
      isProgrammaticRef.current = false;
    }
    submittedTextRef.current = null;
    if (lastHasContentRef.current) {
      lastHasContentRef.current = false;
      onHasContentChangeRef.current?.(false);
    }
    setSuggestion(CLOSED_SUGGESTION);
    setDropdownDismissed(false);
    triggerPosRef.current = null;
  }, [editor, onHasContentChangeRef]);

  // A label arriving for a chip (a facet name, an eval chip's "(pending)")
  // widens it without changing the text, so no update event measures it.
  useEffect(() => {
    if (!editor) return;
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.getMeta(LABEL_REFRESH_META)) {
        measureEndAnchor(editor, editor.getText());
      }
    };
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
    };
  }, [editor, measureEndAnchor]);

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
