import { create } from "zustand";
import type { LiqeQuery } from "liqe";
import {
  parse,
  serialize,
  isEmptyAST,
  getFacetValues,
  getFacetValueState,
  getRangeValue,
  hasCrossFacetOR,
  toggleFacetInQuery,
  setRangeInQuery,
  removeFieldFromQuery,
  removeFacetValueFromQuery,
  ParseError,
} from "../utils/queryParser";

export type { LiqeQuery };
export {
  getFacetValues,
  getFacetValueState,
  getRangeValue,
  isEmptyAST,
  hasCrossFacetOR,
};

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

function defaultTimeRange(): TimeRange {
  const now = Date.now();
  return {
    from: now - 30 * 24 * 60 * 60 * 1000,
    to: now,
    label: "Last 30 days",
    presetId: "30d",
  };
}

export const INITIAL_TIME_RANGE = defaultTimeRange();

/** Parse a query string safely, returning the AST and normalized text */
function safeParseAndSerialize(text: string): {
  ast: LiqeQuery;
  queryText: string;
  parseError: string | null;
} {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ast: EMPTY_AST, queryText: "", parseError: null };
  }
  try {
    const ast = parse(trimmed);
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
    set(() => {
      const result = safeParseAndSerialize(text);
      // If parse failed, keep the text but don't update AST
      if (result.parseError) {
        return { queryText: text, parseError: result.parseError };
      }
      return { ...result, page: 1 };
    }),

  setQuery: (text, ast) =>
    set(() => ({
      ast,
      queryText: text,
      parseError: null,
      page: 1,
    })),

  toggleFacet: (field, value) =>
    set((s) => {
      const currentState = getFacetValueState(s.ast, field, value);
      const newQueryText = toggleFacetInQuery(
        s.queryText,
        field,
        value,
        currentState,
      );
      const result = safeParseAndSerialize(newQueryText);
      return { ...result, page: 1 };
    }),

  removeFacet: (field, value) =>
    set((s) => {
      const newQueryText = removeFacetValueFromQuery(
        s.queryText,
        field,
        value,
      );
      const result = safeParseAndSerialize(newQueryText);
      return { ...result, page: 1 };
    }),

  removeField: (field) =>
    set((s) => {
      const newQueryText = removeFieldFromQuery(s.queryText, field);
      const result = safeParseAndSerialize(newQueryText);
      return { ...result, page: 1 };
    }),

  setRange: (field, from, to) =>
    set((s) => {
      const newQueryText = setRangeInQuery(s.queryText, field, from, to);
      const result = safeParseAndSerialize(newQueryText);
      return { ...result, page: 1 };
    }),

  removeRange: (field) =>
    set((s) => {
      const newQueryText = removeFieldFromQuery(s.queryText, field);
      const result = safeParseAndSerialize(newQueryText);
      return { ...result, page: 1 };
    }),

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
    if (
      s.queryText === s.debouncedQueryText &&
      s.timeRange === s.debouncedTimeRange
    ) {
      return;
    }
    set({
      debouncedQueryText: s.queryText,
      debouncedTimeRange: s.timeRange,
    });
  },
}));

// ─── Legacy compatibility ─────────────────────────────────────────────────────

/**
 * Get include values for a field using legacy field naming.
 * @deprecated Use getFacetValues() directly.
 */
export function getFilterValues(ast: LiqeQuery, legacyField: string): string[] {
  const fieldMap: Record<string, string> = {
    "traces.status": "status",
    "traces.origin": "origin",
    "spans.service": "service",
    "spans.model": "model",
  };
  const field = fieldMap[legacyField] ?? legacyField;
  return getFacetValues(ast, field).include;
}
