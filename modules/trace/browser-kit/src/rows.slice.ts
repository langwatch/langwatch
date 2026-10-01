import type { StateCreator } from "zustand";

import type { ExplorerStore } from "./explorer.store.ts";

/**
 * What the last list read answered for the page state as it stands, kept so a
 * reader of the Explorer (the header count, the pagination line, a Langy
 * `explorer.getState`) answers from one snapshot instead of one query each.
 */
export interface ExplorerResults {
  /** The count the table header shows, or null before the first answer. */
  totalHits: number | null;
  /** The noun the count is of: traces, conversations, groups. */
  itemNoun: string;
  /** The ids on the current page, in table order. */
  pageTraceIds: string[];
  /**
   * Whether the list has answered: false while a read is in flight or the rows
   * shown are still the previous search's, when the count is not yet the count
   * of what the page state asks for.
   */
  isSettled: boolean;
}

export const EMPTY_RESULTS: ExplorerResults = {
  totalHits: null,
  itemNoun: "traces",
  pageTraceIds: [],
  isSettled: false,
};

/**
 * The rows slice of the Explorer store: which rows are open, and what the last
 * read answered.
 */
export interface RowsSlice {
  /** Keys of the rows whose detail is open: a conversation id, a group key. */
  expandedRows: Set<string>;
  setExpandedRows: (keys: Iterable<string>) => void;
  /**
   * Open or close one row. `exclusive` closes every other row first, which is
   * how the Conversations lens keeps one conversation open at a time.
   */
  toggleExpandedRow: (args: { key: string; exclusive?: boolean }) => void;
  results: ExplorerResults;
  setResults: (results: ExplorerResults) => void;
}

/** The row alone when it was closed, nothing when it was the open one. */
function toggledAlone({ open, key }: { open: Set<string>; key: string }): Set<string> {
  return open.has(key) ? new Set<string>() : new Set([key]);
}

/** The row added to, or removed from, the rows already open. */
function toggledAmong({ open, key }: { open: Set<string>; key: string }): Set<string> {
  const next = new Set(open);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export const createRowsSlice: StateCreator<ExplorerStore, [], [], RowsSlice> = (set) => ({
  expandedRows: new Set<string>(),
  results: EMPTY_RESULTS,

  setExpandedRows: (keys) => set({ expandedRows: new Set(keys) }),

  toggleExpandedRow: ({ key, exclusive = false }) =>
    set((state) => ({
      expandedRows: exclusive
        ? toggledAlone({ open: state.expandedRows, key })
        : toggledAmong({ open: state.expandedRows, key }),
    })),

  setResults: (results) =>
    set((state) => {
      const previous = state.results;
      if (
        previous.totalHits === results.totalHits &&
        previous.itemNoun === results.itemNoun &&
        previous.isSettled === results.isSettled &&
        sameIds(previous.pageTraceIds, results.pageTraceIds)
      ) {
        return state;
      }
      return { results };
    }),
});
