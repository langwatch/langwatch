import { type ExplorerStore, useExplorerStore } from "@langwatch/trace-browser-kit";
import type { ExplorerState } from "@langwatch/trace-contract";

/** The page state a transform reads, picked out of the store. */
export function readExplorerState(
  store: ExplorerStore = useExplorerStore.getState(),
): ExplorerState {
  return {
    queryText: store.queryText,
    timeRange: store.timeRange,
    activeLensId: store.activeLensId,
    sort: store.sort,
    grouping: store.grouping,
    columnOrder: store.columnOrder,
    page: store.page,
    pageSize: store.pageSize,
    selection: store.selection,
    expandedRows: store.expandedRows,
    evalRuns: store.evalRuns,
  };
}

const sameSort = (a: ExplorerState["sort"], b: ExplorerState["sort"]) =>
  a.columnId === b.columnId && a.direction === b.direction;

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((item, i) => item === b[i]);

const sameRange = (a: ExplorerState["timeRange"], b: ExplorerState["timeRange"]) =>
  a.from === b.from && a.to === b.to && a.presetId === b.presetId;

interface CommitStep {
  /** Whether the transformed state differs from the store on this field. */
  moved: (next: ExplorerState, store: ExplorerStore) => boolean;
  /** The action a click on the page would have used for it. */
  apply: (next: ExplorerState, store: ExplorerStore) => void;
}

/**
 * The fields in the order they are written: the lens first, then what narrows
 * the list, then how it is shown, and the page last so nothing after it sends
 * the list back to its first page.
 */
const COMMIT_STEPS: readonly CommitStep[] = [
  {
    moved: (next, store) => next.activeLensId !== store.activeLensId,
    apply: (next, store) => store.selectLens(next.activeLensId),
  },
  {
    moved: (next, store) => next.queryText !== store.queryText,
    apply: (next, store) => store.applyQueryText(next.queryText),
  },
  {
    moved: (next, store) => !sameRange(next.timeRange, store.timeRange),
    apply: (next, store) => store.setTimeRange(next.timeRange),
  },
  {
    moved: (next, store) => next.grouping !== store.grouping,
    apply: (next, store) => store.setGrouping(next.grouping),
  },
  {
    moved: (next, store) => !sameSort(next.sort, store.sort),
    apply: (next, store) => store.setSort(next.sort),
  },
  {
    moved: (next, store) => !sameList(next.columnOrder, store.columnOrder),
    apply: (next, store) => store.setVisibleColumns(next.columnOrder),
  },
  {
    moved: (next, store) => next.pageSize !== store.pageSize,
    apply: (next, store) => store.setPageSize(next.pageSize),
  },
  {
    moved: (next, store) => next.page !== store.page,
    apply: (next, store) => store.setPage(next.page),
  },
  {
    moved: (next, store) => next.selection !== store.selection,
    apply: (next, store) => store.setSelection(next.selection),
  },
  {
    moved: (next, store) => next.expandedRows !== store.expandedRows,
    apply: (next, store) => store.setExpandedRows(next.expandedRows),
  },
  {
    moved: (next, store) => next.evalRuns !== store.evalRuns,
    apply: (next, store) => store.setEvalRuns(next.evalRuns),
  },
];

/**
 * Write a transformed state into the store through the store's own actions.
 * The store is re-read before every step because an action moves more than its
 * own field: a lens brings its filter, a new sort returns to page one.
 */
export function commitExplorerState(next: ExplorerState): void {
  for (const step of COMMIT_STEPS) {
    const store = useExplorerStore.getState();
    if (step.moved(next, store)) step.apply(next, store);
  }
}
