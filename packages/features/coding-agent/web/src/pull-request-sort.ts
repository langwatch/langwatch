import {
  type ColumnSortRules,
  type ColumnSortState,
  nextColumnSort,
  type SortDirection,
  sortRowsByColumn,
  useColumnSort,
} from "./column-sort";
import {
  PULL_REQUEST_STATUS_SORT_RANK,
  type PullRequestStatus,
} from "./pull-request-status";

/**
 * The Pull Requests table's columns, named against the shared column-sort
 * shape in `columnSort.ts`.
 *
 * The table opens on the work that moved most recently, because that is the
 * question the page is asked most: what is warm right now.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */

export type PullRequestSortColumn =
  | "number"
  | "title"
  | "status"
  | "lastActivity"
  | "models"
  | "tokens"
  | "cost";

export type PullRequestSortDirection = SortDirection;

export type PullRequestSortState = ColumnSortState<PullRequestSortColumn>;

export const DEFAULT_PULL_REQUEST_SORT = {
  column: "lastActivity",
  direction: "desc",
} as const satisfies PullRequestSortState;

/** Everything a row has to carry for the table's order to be decidable. */
export interface SortablePullRequestRow {
  pullRequest: { number: number; title: string } | null;
  headBranch: string;
  snapshotStatus: PullRequestStatus | null;
  lastActivityAtMs: number;
  modelBreakdown: ReadonlyArray<{ model: string }>;
  totalTokens: number;
  costUsd: number | null;
}

const PULL_REQUEST_SORT_RULES: ColumnSortRules<
  PullRequestSortColumn,
  SortablePullRequestRow
> = {
  defaultSort: DEFAULT_PULL_REQUEST_SORT,
  // A measure leads with its largest value, a name leads with A, and a status
  // leads with the work still in flight.
  initialDirection: {
    number: "desc",
    title: "asc",
    status: "asc",
    lastActivity: "desc",
    models: "asc",
    tokens: "desc",
    cost: "desc",
  },
  keyOf: {
    number: (row) => row.pullRequest?.number ?? null,
    title: (row) => (row.pullRequest?.title || row.headBranch).toLowerCase(),
    status: (row) =>
      row.snapshotStatus === null
        ? null
        : PULL_REQUEST_STATUS_SORT_RANK[row.snapshotStatus],
    lastActivity: (row) => row.lastActivityAtMs,
    models: (row) => row.modelBreakdown[0]?.model.toLowerCase() ?? null,
    tokens: (row) => row.totalTokens,
    cost: (row) => row.costUsd,
  },
  tieBreak: (left, right) => right.lastActivityAtMs - left.lastActivityAtMs,
};

/**
 * The next sort a click on `column` asks for. A column the table is not
 * sorted by starts in its own reading direction, a second click reverses it,
 * and a third gives the table back its opening order.
 */
export function nextPullRequestSort({
  current,
  column,
}: {
  current: PullRequestSortState;
  column: PullRequestSortColumn;
}): PullRequestSortState {
  return nextColumnSort({ current, column, rules: PULL_REQUEST_SORT_RULES });
}

/**
 * The rows in the order the table draws them. Every column falls back to the
 * most recently updated row, so two rows a column cannot tell apart still read
 * in the order the page opened in.
 */
export function sortPullRequestRows<T extends SortablePullRequestRow>({
  rows,
  sort,
}: {
  rows: readonly T[];
  sort: PullRequestSortState;
}): T[] {
  return sortRowsByColumn({ rows, sort, rules: PULL_REQUEST_SORT_RULES });
}

export function usePullRequestSort<T extends SortablePullRequestRow>({
  rows,
}: {
  rows: readonly T[];
}): {
  sorted: T[];
  sort: PullRequestSortState;
  onSort: (column: PullRequestSortColumn) => void;
} {
  return useColumnSort({ rows, rules: PULL_REQUEST_SORT_RULES });
}
