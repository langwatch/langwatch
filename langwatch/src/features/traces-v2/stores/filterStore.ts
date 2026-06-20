import type { LiqeQuery } from "liqe";
import { create } from "zustand";
import type { AiActionError } from "~/server/app-layer/traces/ai-query";
import {
  removeEvaluatorScoreRangeInQuery,
  setEvaluatorScoreRangeInQuery,
  toggleEvaluatorSubFilterInQuery,
} from "~/server/app-layer/traces/query-language/evaluatorGroup";
import {
  addSameFieldOrValue,
  addToOrGroupAtLocation,
  removeFacetValueFromQuery,
  removeFieldFromQuery,
  removeImplicitTermFromQuery,
  setFacetValueAtLocation,
  setRangeInQuery,
  swapOperatorAtLocation,
  toggleFacetInQuery,
} from "~/server/app-layer/traces/query-language/mutations";
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

  /**
   * Structured error from the most recent Ask AI attempt. Persists until
   * the user explicitly dismisses it, types a new query, submits a new AI
   * prompt, or calls `clearAll`. Set by `AiQueryComposer` via `setAiError`
   * so the unified error banner in `SearchBar` can read it.
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
   * The most recent successful Ask AI translation: the natural-language
   * prompt the user typed and the query the model produced. Read by the
   * search bar so re-entering AI mode after an AI translation re-shows
   * the user's original prompt rather than the generated query (which
   * would be the URL state). Cleared the moment any other code path
   * mutates the query — facet toggle, free-text edit, lens switch — so
   * we never re-show a stale prompt against an unrelated query.
   *
   * `projectId` scoping protects against showing one project's prompt
   * after the user switches workspaces (the store is module-level and
   * persists across project changes).
   */
  lastAiTranslation: {
    projectId: string;
    prompt: string;
    query: string;
  } | null;

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
   *
   * Adding a value (neutral → include) follows faceted-search semantics:
   *   - A SECOND value of the same field OR-combines with the existing one
   *     automatically on a plain click — `origin:sample` becomes
   *     `(origin:sample OR origin:application)` — because a field can't
   *     equal two values at once, so AND-ing them matches nothing.
   *   - A value in a DIFFERENT field AND-combines (the narrowing default).
   *   - Pass `combinator: "OR"` (a cross-field Shift/Ctrl-click in the
   *     sidebar) to force a fresh top-level OR scope across fields instead.
   *   - Pass `orGroupLocation` to splice the new value into an existing OR
   *     group (the third-and-beyond value of an already-OR-grouped facet).
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
   * Force a facet value into the EXCLUDED (`NOT field:value`) state,
   * regardless of its current state — drives the row's trailing exclude
   * (`−`) affordance so "exclude" is one deliberate click rather than a
   * double-click through the include→exclude cycle. Toggles back to
   * neutral when the value is already excluded. Always AND-combines the
   * negation (the facet UI never emits `NOT … OR …`).
   */
  excludeFacet: (field: string, value: string) => void;
  /**
   * Toggle a verdict / label sub-condition scoped to a single evaluator's
   * parenthesised group — `(evaluator:X AND evaluatorVerdict:pass)` — so the
   * sub-condition binds to that one evaluation rather than floating at the top
   * level. Cycles neutral → include → exclude → neutral; the evaluator anchor
   * is added automatically and removed when its last sub-condition clears.
   */
  toggleEvaluatorSubFilter: (args: {
    evaluatorId: string;
    field: string;
    value: string;
  }) => void;
  /** Set the score range inside an evaluator's group (adds the anchor). */
  setEvaluatorScoreRange: (args: {
    evaluatorId: string;
    from: string;
    to: string;
  }) => void;
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
  setPageSize: (size: number) => void;
  clearAll: () => void;
  /** Update the debounced values (usually called by a global timer/effect) */
  commitDebounced: () => void;

  /** Record the last AI prompt + result so the next AI mode entry can
   * surface the original natural-language prompt instead of the produced
   * query string. */
  recordAiTranslation: (translation: {
    projectId: string;
    prompt: string;
    query: string;
  }) => void;
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
  return { ...next, page: 1, lastAiTranslation: null };
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
  aiError: null,
  timeRange: INITIAL_TIME_RANGE,
  page: 1,
  pageSize: 50,
  debouncedQueryText: "",
  debouncedTimeRange: INITIAL_TIME_RANGE,
  lastAiTranslation: null,

  setAiError: (err) => set({ aiError: err }),
  dismissParseError: () => set({ parseError: null }),

  recordAiTranslation: (translation) => set({ lastAiTranslation: translation }),

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
        return {
          queryText: text,
          parseError: result.parseError,
          aiError: null,
          lastAiTranslation: null,
        };
      }
      // Canonical text matches and we're already error-free → the AST is
      // structurally the same. Keep the previous reference so `s.ast`
      // subscribers don't churn on a round-trip-equivalent edit.
      if (
        result.queryText === state.queryText &&
        state.parseError === null &&
        state.aiError === null
      ) {
        return state;
      }
      return { ...result, aiError: null, page: 1, lastAiTranslation: null };
    }),

  setQuery: (text, ast) =>
    set({
      ast,
      queryText: text,
      parseError: null,
      page: 1,
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
          lastAiTranslation: null,
        };
      }
      return { ...result, page: 1, lastAiTranslation: null };
    }),

  toggleFacet: (field, value, options) =>
    set((s) => {
      const state = getFacetValueState(s.ast, field, value);
      // OR-group splice path: when the field is already part of an OR
      // group (2+ values) AND we're adding a new value, splice it into
      // the same group via `addToOrGroupAtLocation` instead of
      // AND-combining at the top. Removal still goes through
      // removeFacetValueFromQuery which walks the whole AST.
      if (state === "neutral" && options?.orGroupLocation) {
        return applyMutation(s, (q) =>
          addToOrGroupAtLocation({
            currentQuery: q,
            groupStart: options.orGroupLocation!.start,
            groupEnd: options.orGroupLocation!.end,
            fieldName: field,
            value,
          }),
        );
      }
      // Same-field OR creation path: a plain click adding the SECOND
      // value of a field has no group to splice into yet (a group needs
      // 2+ members to exist). Folding it together with the existing bare
      // value via OR — `origin:sample` → `(origin:sample OR
      // origin:application)` — is the correct faceted-search default,
      // since a field can't equal two values at once. Skipped when the
      // caller forced `combinator: "OR"` (a cross-field Shift/Ctrl-click,
      // which deliberately opens a new top-level OR scope instead).
      if (state === "neutral" && options?.combinator !== "OR") {
        return applyMutation(s, (q) =>
          addSameFieldOrValue({ currentQuery: q, fieldName: field, value }),
        );
      }
      return applyMutation(s, (q) =>
        toggleFacetInQuery({
          currentQuery: q,
          fieldName: field,
          value,
          currentState: state,
          combinator: options?.combinator ?? "AND",
        }),
      );
    }),

  excludeFacet: (field, value) =>
    set((s) => {
      const state = getFacetValueState(s.ast, field, value);
      // Already excluded → second press on the `−` toggles it back off.
      if (state === "exclude") {
        return applyMutation(s, (q) =>
          removeFacetValueFromQuery({ currentQuery: q, fieldName: field, value }),
        );
      }
      // Force exclude from neutral OR include. `toggleFacetInQuery`'s
      // `currentState: "include"` branch first strips any existing clause
      // for this value, then appends `NOT field:value` — exactly the
      // "make it excluded" result we want regardless of where it started.
      return applyMutation(s, (q) =>
        toggleFacetInQuery({
          currentQuery: q,
          fieldName: field,
          value,
          currentState: "include",
        }),
      );
    }),

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
      applyMutation(s, (q) =>
        removeEvaluatorScoreRangeInQuery({ currentQuery: q, evaluatorId }),
      ),
    ),

  swapOperator: (start, end) =>
    set((s) =>
      applyMutation(s, (q) =>
        swapOperatorAtLocation({ currentQuery: q, start, end }),
      ),
    ),

  setFacetValueAt: (start, end, newValue) =>
    set((s) =>
      applyMutation(s, (q) =>
        setFacetValueAtLocation({ currentQuery: q, start, end, newValue }),
      ),
    ),

  removeFacet: (field, value) =>
    set((s) =>
      applyMutation(s, (q) =>
        removeFacetValueFromQuery({ currentQuery: q, fieldName: field, value }),
      ),
    ),

  removeField: (field) =>
    set((s) =>
      applyMutation(s, (q) =>
        removeFieldFromQuery({ currentQuery: q, fieldName: field }),
      ),
    ),

  removeFreeText: (value) =>
    set((s) =>
      applyMutation(s, (q) =>
        removeImplicitTermFromQuery({ currentQuery: q, value }),
      ),
    ),

  setRange: (field, from, to) =>
    set((s) =>
      applyMutation(s, (q) =>
        setRangeInQuery({ currentQuery: q, fieldName: field, from, to }),
      ),
    ),

  removeRange: (field) =>
    set((s) =>
      applyMutation(s, (q) =>
        removeFieldFromQuery({ currentQuery: q, fieldName: field }),
      ),
    ),

  setTimeRange: (range) => set({ timeRange: range, page: 1 }),
  rollTimeRange: (range) => set({ timeRange: range }),
  setPage: (page) => set({ page }),
  setPageSize: (size) => set({ pageSize: size, page: 1 }),
  clearAll: () =>
    set({
      ast: EMPTY_AST,
      queryText: "",
      parseError: null,
      aiError: null,
      page: 1,
      lastAiTranslation: null,
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
