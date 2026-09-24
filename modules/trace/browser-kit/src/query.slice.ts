import { nowInstant } from "@langwatch/time";
import type { AiActionError, ModelTrouble } from "@langwatch/trace-contract";
import {
  excludedFacetQuery,
  isEmptyAST,
  ParseError,
  parse,
  removeFacetValueFromQuery,
  removeEvaluatorScoreRangeInQuery,
  removeFieldFromQuery,
  removeImplicitTermFromQuery,
  serialize,
  setEvaluatorScoreRangeInQuery,
  setFacetValueAtLocation,
  setRangeInQuery,
  swapOperatorAtLocation,
  toggleEvaluatorSubFilterInQuery,
  toggledFacetQuery,
  validateAst,
} from "@langwatch/trace-contract";
import type { LiqeQuery } from "liqe";
import type { StateCreator } from "zustand";

import type { ExplorerStore } from "./explorer.store.ts";

export interface TimeRange {
  from: number;
  to: number;
  label?: string;
  /** When set, the range was selected via this preset and rolls forward. */
  presetId?: string;
}

export interface TraceListCursor {
  sortValue: number;
  traceId: string;
}

/**
 * Cursor recorded per visited page. The flat lens stores the structured trace keyset
 * cursor; the sessions lens stores the opaque string cursor `traces.sessions` hands
 * back.
 */
export type PageCursor = TraceListCursor | string;

export interface QuerySlice {
  /** The parsed query AST (liqe) — single source of truth */
  ast: LiqeQuery;
  /** Serialized query string — always in sync with ast */
  queryText: string;
  /** Parse error from last invalid input */
  parseError: string | null;

  timeRange: TimeRange;
  page: number;
  pageSize: number;
  /** Cursor used to enter each visited batch. Page 1 intentionally uses null. */
  pageCursors: Record<number, PageCursor | null>;

  /** Debounced version of queryText to drive network requests */
  debouncedQueryText: string;
  /** Debounced version of timeRange to drive network requests */
  debouncedTimeRange: TimeRange;

  /**
   * The Instant Eval runs behind the query's `eval` chips: the run key (the
   * question, the unit judged, the other chips and the window) to the run id.
   * A key with no entry is pending. In the URL as `run=<key>:<runId>`.
   */
  evalRuns: Record<string, string>;
  /** Register the run started for a chip's key. */
  registerEvalRun: (args: { key: string; runId: string }) => void;
  /** Replace the whole registry, which is what a URL apply does. */
  setEvalRuns: (runs: Record<string, string>) => void;

  /**
   * Structured error from the most recent Ask AI attempt. Persists until the user
   * explicitly dismisses it, types a new query, submits a new AI prompt, or calls
   * `clearAll`.
   */
  aiError: AiActionError | null;
  /** Set (or clear) the AI error shown in the unified banner. */
  setAiError: (err: AiActionError | null) => void;
  /**
   * Dismiss the parse error banner without touching the query text. The
   * invalid text stays in the editor so the user can correct it — the
   * banner is just hidden until they trigger a new parse cycle.
   */
  dismissParseError: () => void;

  /**
   * The most recent successful Ask AI translation: the natural-language prompt the user
   * typed and the query the model produced.
   */
  lastAiTranslation: {
    projectId: string;
    prompt: string;
    query: string;
  } | null;

  /**
   * What the strip under the bar says when a model was missing from the search
   * that just ran. It shows while `query` is what the bar holds, so the next edit
   * retires it; `projectId` guards a workspace switch, as `lastAiTranslation` does.
   */
  searchNotice: SearchNotice | null;

  /** Apply a query string from the search bar (parses → AST) */
  applyQueryText: (text: string) => void;
  /** Set query text and AST together */
  setQuery: (text: string, ast: LiqeQuery) => void;
  /**
   * Apply a saved lens's filter expression. Identical to `applyQueryText`
   * except a parse error in saved data falls back to empty silently
   * rather than surfacing the error to the user.
   */
  setFilterFromLens: (text: string) => void;

  /**
   * Three-stage facet toggle: neutral → include → exclude → neutral.
   */
  toggleFacet: (
    field: string,
    value: string,
    options?: {
      combinator?: "AND" | "OR";
      orGroupLocation?: { start: number; end: number };
    },
  ) => void;
  /**
   * Force a facet value into the EXCLUDED (`NOT field:value`) state, regardless of its
   * current state — drives the row's trailing exclude (`−`) affordance so "exclude" is
   * one deliberate click rather than a double-click through the include→exclude cycle.
   */
  excludeFacet: (field: string, value: string) => void;
  /**
   * Toggle a verdict / label sub-condition scoped to a single evaluator's parenthesised
   * group — `(evaluator:X AND evaluatorVerdict:pass)` — so the sub-condition binds to
   * that one evaluation rather than floating at the top level.
   */
  toggleEvaluatorSubFilter: (args: { evaluatorId: string; field: string; value: string }) => void;
  /** Set the score range inside an evaluator's group (adds the anchor). */
  setEvaluatorScoreRange: (args: { evaluatorId: string; from: string; to: string }) => void;
  /** Clear just the score range from an evaluator's group. */
  removeEvaluatorScoreRange: (args: { evaluatorId: string }) => void;

  /** Swap the AND/OR keyword at a given liqe text location. Used by the
   * search-bar token cycle handler. */
  swapOperator: (start: number, end: number) => void;

  /** Replace the value of the Tag at the given liqe location. Used by
   * the click-a-token-to-edit-value popover in the search bar. */
  setFacetValueAt: (start: number, end: number, newValue: string) => void;
  /** Remove a specific facet value (force to neutral) */
  removeFacet: (field: string, value: string) => void;
  /** Remove all values for a field */
  removeField: (field: string) => void;
  /** Remove a free-text (ImplicitField) literal from the query. Used by
   *  the empty-state query breakdown chips to drop accidental glyphs
   *  ("Ω") without clearing the whole query. */
  removeFreeText: (value: string) => void;

  /** Set a range filter */
  setRange: (field: string, from: string, to: string) => void;
  /** Remove a range filter */
  removeRange: (field: string) => void;

  setTimeRange: (range: TimeRange) => void;
  /** Roll forward an existing preset range without resetting page. */
  rollTimeRange: (range: TimeRange) => void;
  setPage: (page: number) => void;
  /** File the cursor that enters a page under that page's number. */
  setPageCursor: (args: { page: number; cursor: PageCursor | null }) => void;
  resetPagination: () => void;
  setPageSize: (size: number) => void;
  clearAll: () => void;
  /** Update the debounced values (usually called by a global timer/effect) */
  commitDebounced: () => void;

  /** Record the last AI prompt + result so the next AI mode entry can
   * surface the original natural-language prompt instead of the produced
   * query string. */
  recordAiTranslation: (translation: { projectId: string; prompt: string; query: string }) => void;

  /** Say what the search that just landed was read as, and what is missing. */
  recordSearchNotice: (notice: SearchNotice) => void;
}

/**
 * The strip's content: what the sentence was read as, and which of the two model
 * problems is behind it. With no model, or one that does not answer, the search
 * still runs (a judgement of the words as typed, or a phrase) and this says so.
 */
export interface SearchNotice {
  projectId: string;
  /** The query text this is about. The strip hides once the bar moves on. */
  query: string;
  /** What the sentence was read as. */
  interpretedAs: "instant_eval" | "free_text";
  modelTrouble: ModelTrouble;
  /** The handled code of the failure, when it carried one. */
  modelErrorCode?: string;
}

const EMPTY_AST: LiqeQuery = {
  type: "EmptyExpression",
  location: { start: 0, end: 0 },
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function defaultTimeRange(): TimeRange {
  const now = nowInstant().epochMilliseconds;
  return {
    from: now - THIRTY_DAYS_MS,
    to: now,
    label: "Last 30 days",
    presetId: "30d",
  };
}

export const INITIAL_TIME_RANGE = defaultTimeRange();

interface ParseResult {
  ast: LiqeQuery;
  queryText: string;
  parseError: string | null;
}

function safeParseAndSerialize(text: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ast: EMPTY_AST, queryText: "", parseError: null };
  }
  try {
    const ast = parse(trimmed);
    const semanticError = validateAst(ast);
    if (semanticError) {
      return { ast: EMPTY_AST, queryText: text, parseError: semanticError };
    }
    const queryText = isEmptyAST(ast) ? "" : serialize(ast);
    return { ast, queryText, parseError: null };
  } catch (e) {
    const message =
      e instanceof ParseError
        ? e.message
        : "Invalid query syntax — check for unmatched quotes or parentheses.";
    return { ast: EMPTY_AST, queryText: text, parseError: message };
  }
}

/**
 * The state after the search bar's text is applied. An unchanged canonical
 * text keeps the previous state reference, so `ast` subscribers do not churn
 * on a round-trip-equivalent edit.
 */
function appliedQueryText({ state, text }: { state: QuerySlice; text: string }) {
  const result = safeParseAndSerialize(text);
  if (result.parseError) {
    if (text === state.queryText && result.parseError === state.parseError) {
      return state;
    }
    return {
      queryText: text,
      parseError: result.parseError,
      aiError: null,
      lastAiTranslation: null,
    };
  }
  if (result.queryText === state.queryText && state.parseError === null && state.aiError === null) {
    return state;
  }
  return {
    ...result,
    aiError: null,
    page: 1,
    pageCursors: { 1: null },
    lastAiTranslation: null,
  };
}

function applyMutation(state: QuerySlice, mutate: (text: string) => string) {
  const next = safeParseAndSerialize(mutate(state.queryText));
  return {
    ...next,
    page: 1,
    pageCursors: { 1: null },
    lastAiTranslation: null,
  };
}

/**
 * The query, window and pagination slice of the Explorer store. Lens
 * dirty-tracking belongs to `useLensFilterDirtySync`; this slice never reaches
 * into the view slice.
 */
export const createQuerySlice: StateCreator<ExplorerStore, [], [], QuerySlice> = (set, get) => ({
  ast: EMPTY_AST,
  queryText: "",
  parseError: null,
  aiError: null,
  timeRange: INITIAL_TIME_RANGE,
  page: 1,
  pageSize: 50,
  pageCursors: { 1: null },
  debouncedQueryText: "",
  debouncedTimeRange: INITIAL_TIME_RANGE,
  lastAiTranslation: null,
  searchNotice: null,
  evalRuns: {},

  registerEvalRun: ({ key, runId }) =>
    set((state) => ({ evalRuns: { ...state.evalRuns, [key]: runId } })),
  setEvalRuns: (runs) => set({ evalRuns: runs }),

  setAiError: (err) => set({ aiError: err }),
  dismissParseError: () => set({ parseError: null }),

  recordAiTranslation: (translation) => set({ lastAiTranslation: translation }),

  recordSearchNotice: (notice) => set({ searchNotice: notice }),

  applyQueryText: (text) => set((state) => appliedQueryText({ state, text })),

  setQuery: (text, ast) =>
    set({
      ast,
      queryText: text,
      parseError: null,
      page: 1,
      pageCursors: { 1: null },
      lastAiTranslation: null,
    }),

  setFilterFromLens: (text) =>
    set(() => {
      const result = safeParseAndSerialize(text);
      // If the saved lens text is unparseable (corrupt persistence), fall
      // back to empty rather than surfacing a parse error to the user.
      if (result.parseError) {
        return {
          ast: EMPTY_AST,
          queryText: "",
          parseError: null,
          page: 1,
          pageCursors: { 1: null },
          lastAiTranslation: null,
        };
      }
      return {
        ...result,
        page: 1,
        pageCursors: { 1: null },
        lastAiTranslation: null,
      };
    }),

  toggleFacet: (field, value, options) =>
    set((s) =>
      applyMutation(s, (queryText) => toggledFacetQuery({ queryText, field, value, ...options })),
    ),

  excludeFacet: (field, value) =>
    set((s) => applyMutation(s, (queryText) => excludedFacetQuery({ queryText, field, value }))),

  toggleEvaluatorSubFilter: ({ evaluatorId, field, value }) =>
    set((s) =>
      applyMutation(s, (q) =>
        toggleEvaluatorSubFilterInQuery({
          currentQuery: q,
          evaluatorId,
          field,
          value,
        }),
      ),
    ),

  setEvaluatorScoreRange: ({ evaluatorId, from, to }) =>
    set((s) =>
      applyMutation(s, (q) =>
        setEvaluatorScoreRangeInQuery({
          currentQuery: q,
          evaluatorId,
          from,
          to,
        }),
      ),
    ),

  removeEvaluatorScoreRange: ({ evaluatorId }) =>
    set((s) =>
      applyMutation(s, (q) => removeEvaluatorScoreRangeInQuery({ currentQuery: q, evaluatorId })),
    ),

  swapOperator: (start, end) =>
    set((s) => applyMutation(s, (q) => swapOperatorAtLocation({ currentQuery: q, start, end }))),

  setFacetValueAt: (start, end, newValue) =>
    set((s) =>
      applyMutation(s, (q) => setFacetValueAtLocation({ currentQuery: q, start, end, newValue })),
    ),

  removeFacet: (field, value) =>
    set((s) =>
      applyMutation(s, (q) =>
        removeFacetValueFromQuery({ currentQuery: q, fieldName: field, value }),
      ),
    ),

  removeField: (field) =>
    set((s) =>
      applyMutation(s, (q) => removeFieldFromQuery({ currentQuery: q, fieldName: field })),
    ),

  removeFreeText: (value) =>
    set((s) => applyMutation(s, (q) => removeImplicitTermFromQuery({ currentQuery: q, value }))),

  setRange: (field, from, to) =>
    set((s) =>
      applyMutation(s, (q) => setRangeInQuery({ currentQuery: q, fieldName: field, from, to })),
    ),

  removeRange: (field) =>
    set((s) =>
      applyMutation(s, (q) => removeFieldFromQuery({ currentQuery: q, fieldName: field })),
    ),

  setTimeRange: (range) => set({ timeRange: range, page: 1, pageCursors: { 1: null } }),
  rollTimeRange: (range) => set({ timeRange: range }),
  setPage: (page) => set({ page }),
  setPageCursor: ({ page, cursor }) =>
    set((state) => ({
      pageCursors: { ...state.pageCursors, [page]: cursor },
    })),
  resetPagination: () => set({ page: 1, pageCursors: { 1: null } }),
  setPageSize: (size) => set({ pageSize: size, page: 1, pageCursors: { 1: null } }),
  clearAll: () =>
    set({
      ast: EMPTY_AST,
      queryText: "",
      parseError: null,
      aiError: null,
      page: 1,
      pageCursors: { 1: null },
      lastAiTranslation: null,
      searchNotice: null,
      evalRuns: {},
    }),

  commitDebounced: () => {
    const s = get();
    // Don't commit a query string the server will reject — keep the previous
    // debounced value so polling/refetches don't re-fire the doomed request.
    set({
      debouncedQueryText: s.parseError ? s.debouncedQueryText : s.queryText,
      debouncedTimeRange: s.timeRange,
    });
  },
});
