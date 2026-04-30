import type { LiqeQuery } from "liqe";
import { create } from "zustand";
import {
  isEmptyAST,
  ParseError,
  parse,
  serialize,
} from "~/server/app-layer/traces/query-language/parse";
import {
  getFacetValueState,
  validateAst,
} from "~/server/app-layer/traces/query-language/queries";
import {
  removeFacetValueFromQuery,
  removeFieldFromQuery,
  setRangeInQuery,
  toggleFacetInQuery,
} from "~/server/app-layer/traces/query-language/mutations";

export interface TimeRange {
  from: number;
  to: number;
  label?: string;
  /** When set, the range was selected via this preset and rolls forward. */
  presetId?: string;
}

interface FilterState {
  /** The parsed query AST (liqe) — single source of truth */
  ast: LiqeQuery;
  /** Serialized query string — always in sync with ast */
  queryText: string;
  /** Parse error from last invalid input */
  parseError: string | null;

  timeRange: TimeRange;
  page: number;
  pageSize: number;

  /** Debounced version of queryText to drive network requests */
  debouncedQueryText: string;
  /** Debounced version of timeRange to drive network requests */
  debouncedTimeRange: TimeRange;

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

  /** Three-stage facet toggle: neutral → include → exclude → neutral */
  toggleFacet: (field: string, value: string) => void;
  /** Remove a specific facet value (force to neutral) */
  removeFacet: (field: string, value: string) => void;
  /** Remove all values for a field */
  removeField: (field: string) => void;

  /** Set a range filter */
  setRange: (field: string, from: string, to: string) => void;
  /** Remove a range filter */
  removeRange: (field: string) => void;

  setTimeRange: (range: TimeRange) => void;
  /** Roll forward an existing preset range without resetting page. */
  rollTimeRange: (range: TimeRange) => void;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  clearAll: () => void;
  /** Update the debounced values (usually called by a global timer/effect) */
  commitDebounced: () => void;
}

const EMPTY_AST: LiqeQuery = {
  type: "EmptyExpression",
  location: { start: 0, end: 0 },
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function defaultTimeRange(): TimeRange {
  const now = Date.now();
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

function applyMutation(state: FilterState, mutate: (text: string) => string) {
  const next = safeParseAndSerialize(mutate(state.queryText));
  return { ...next, page: 1 };
}

/**
 * Pure store. The lens dirty-tracking is handled by `useLensFilterDirtySync`
 * (mounted in TracesPage), which subscribes to `queryText` and updates the
 * active lens's draft. filterStore never reaches into viewStore.
 */
export const useFilterStore = create<FilterState>((set, get) => ({
  ast: EMPTY_AST,
  queryText: "",
  parseError: null,
  timeRange: INITIAL_TIME_RANGE,
  page: 1,
  pageSize: 50,
  debouncedQueryText: "",
  debouncedTimeRange: INITIAL_TIME_RANGE,

  applyQueryText: (text) =>
    set((state) => {
      const result = safeParseAndSerialize(text);
      if (result.parseError) {
        if (
          text === state.queryText &&
          result.parseError === state.parseError
        ) {
          return state;
        }
        return { queryText: text, parseError: result.parseError };
      }
      // Canonical text matches and we're already error-free → the AST is
      // structurally the same. Keep the previous reference so `s.ast`
      // subscribers don't churn on a round-trip-equivalent edit.
      if (
        result.queryText === state.queryText &&
        state.parseError === null
      ) {
        return state;
      }
      return { ...result, page: 1 };
    }),

  setQuery: (text, ast) =>
    set({
      ast,
      queryText: text,
      parseError: null,
      page: 1,
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
        };
      }
      return { ...result, page: 1 };
    }),

  toggleFacet: (field, value) =>
    set((s) =>
      applyMutation(s, (q) =>
        toggleFacetInQuery(
          q,
          field,
          value,
          getFacetValueState(s.ast, field, value),
        ),
      ),
    ),

  removeFacet: (field, value) =>
    set((s) =>
      applyMutation(s, (q) => removeFacetValueFromQuery(q, field, value)),
    ),

  removeField: (field) =>
    set((s) => applyMutation(s, (q) => removeFieldFromQuery(q, field))),

  setRange: (field, from, to) =>
    set((s) => applyMutation(s, (q) => setRangeInQuery(q, field, from, to))),

  removeRange: (field) =>
    set((s) => applyMutation(s, (q) => removeFieldFromQuery(q, field))),

  setTimeRange: (range) => set({ timeRange: range, page: 1 }),
  rollTimeRange: (range) => set({ timeRange: range }),
  setPage: (page) => set({ page }),
  setPageSize: (size) => set({ pageSize: size, page: 1 }),
  clearAll: () =>
    set({
      ast: EMPTY_AST,
      queryText: "",
      parseError: null,
      page: 1,
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
}));

// Allow other modules to read the canonical filter text without importing
// the React hook (used by `useLensStore` actions like create/save).
export function getCurrentFilterText(): string {
  try {
    return useFilterStore.getState().queryText;
  } catch {
    return "";
  }
}
