import { useCallback, useMemo, useState } from "react";

import {
  PULL_REQUEST_STATUS_SORT_RANK,
  type PullRequestStatus,
} from "./pullRequestStatus";

/**
 * The order the Pull Requests table reads in, and the way back to it.
 *
 * The table opens on the work that moved most recently, because that is the
 * question the page is asked most: what is warm right now. Every column can
 * take over from there, and a third click on the same column hands the table
 * back to the order it opened in, so trying a sort costs nothing.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */

export type PullRequestSortColumn =
  | "number"
  | "title"
  | "status"
  | "lastActivity"
  | "sessions"
  | "models"
  | "tokens"
  | "cost";

export type PullRequestSortDirection = "asc" | "desc";

export interface PullRequestSortState {
  column: PullRequestSortColumn;
  direction: PullRequestSortDirection;
}

export const DEFAULT_PULL_REQUEST_SORT = {
  column: "lastActivity",
  direction: "desc",
} as const satisfies PullRequestSortState;

/**
 * Which way a column is read on the first click: a measure leads with its
 * largest value, a name leads with A, and a status leads with the work still
 * in flight.
 */
const INITIAL_DIRECTION = {
  number: "desc",
  title: "asc",
  status: "asc",
  lastActivity: "desc",
  sessions: "desc",
  models: "asc",
  tokens: "desc",
  cost: "desc",
} as const satisfies Record<PullRequestSortColumn, PullRequestSortDirection>;

/** Everything a row has to carry for the table's order to be decidable. */
export interface SortablePullRequestRow {
  pullRequest: { number: number; title: string } | null;
  headBranch: string;
  snapshotStatus: PullRequestStatus | null;
  lastActivityAtMs: number;
  sessionsCount: number;
  modelBreakdown: ReadonlyArray<{ model: string }>;
  totalTokens: number;
  costUsd: number | null;
}

/**
 * What a column sorts a row by. `null` means the column does not apply to this
 * row at all, which is a different thing from a small value: a branch has no
 * pull request number and no status, and a project the reader may not price
 * has no cost.
 */
type SortKey = number | string | null;

const keyOf: Record<
  PullRequestSortColumn,
  (row: SortablePullRequestRow) => SortKey
> = {
  number: (row) => row.pullRequest?.number ?? null,
  title: (row) => (row.pullRequest?.title || row.headBranch).toLowerCase(),
  status: (row) =>
    row.snapshotStatus === null
      ? null
      : PULL_REQUEST_STATUS_SORT_RANK[row.snapshotStatus],
  lastActivity: (row) => row.lastActivityAtMs,
  sessions: (row) => row.sessionsCount,
  models: (row) => row.modelBreakdown[0]?.model.toLowerCase() ?? null,
  tokens: (row) => row.totalTokens,
  cost: (row) => row.costUsd,
};

/**
 * One column's comparison. A row the column does not apply to sinks to the
 * bottom whichever way the column is read: flipping the direction is a request
 * to reverse the values, not to promote the rows that have none.
 */
function compareByColumn({
  left,
  right,
  column,
  direction,
}: {
  left: SortablePullRequestRow;
  right: SortablePullRequestRow;
  column: PullRequestSortColumn;
  direction: PullRequestSortDirection;
}): number {
  const a = keyOf[column](left);
  const b = keyOf[column](right);
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  const sign = direction === "asc" ? 1 : -1;
  if (typeof a === "string" || typeof b === "string") {
    return String(a).localeCompare(String(b)) * sign;
  }
  return (a - b) * sign;
}

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
  const initial = INITIAL_DIRECTION[column];
  if (current.column !== column) return { column, direction: initial };
  if (current.direction === initial) {
    return { column, direction: initial === "asc" ? "desc" : "asc" };
  }
  return DEFAULT_PULL_REQUEST_SORT;
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
  return [...rows].sort((left, right) => {
    const byColumn = compareByColumn({
      left,
      right,
      column: sort.column,
      direction: sort.direction,
    });
    if (byColumn !== 0) return byColumn;
    return right.lastActivityAtMs - left.lastActivityAtMs;
  });
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
  const [sort, setSort] = useState<PullRequestSortState>(
    DEFAULT_PULL_REQUEST_SORT,
  );

  const sorted = useMemo(
    () => sortPullRequestRows({ rows, sort }),
    [rows, sort],
  );

  const onSort = useCallback((column: PullRequestSortColumn) => {
    setSort((current) => nextPullRequestSort({ current, column }));
  }, []);

  return { sorted, sort, onSort };
}
