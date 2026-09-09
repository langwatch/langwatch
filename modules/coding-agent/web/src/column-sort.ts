import { useCallback, useMemo, useState } from "react";

/**
 * The order a personal list table reads in, and the way back to it.
 *
 * Which columns a table has is its own business; how a column behaves is not.
 * Every one of these tables opens on the work that moved most recently, any
 * heading can take over from there, and a third click on the same heading hands
 * the table back the order it opened in, so trying a sort costs nothing. That
 * shape lives here, and each table names its own columns against it.
 *
 * Specs: specs/coding-agent/pull-request-linkage.feature,
 *        specs/coding-agent/sessions-screen.feature.
 */

export type SortDirection = "asc" | "desc";

export interface ColumnSortState<Column extends string> {
  column: Column;
  direction: SortDirection;
}

/**
 * What a column sorts a row by. `null` means the column does not apply to this
 * row at all, which is a different thing from a small value: a branch has no
 * pull request number, a session may have driven no pull request, and a project
 * the reader may not price has no cost.
 */
export type SortKey = number | string | null;

/** Everything one table has to say for its own order to be decidable. */
export interface ColumnSortRules<Column extends string, Row> {
  /** The order the table opens in, and the one a third click returns to. */
  defaultSort: ColumnSortState<Column>;
  /**
   * Which way a column is read on the first click: a measure leads with its
   * largest value, a name leads with A.
   */
  initialDirection: Record<Column, SortDirection>;
  /** What each column sorts a row by. */
  keyOf: Record<Column, (row: Row) => SortKey>;
  /** The order two rows a column cannot tell apart read in. */
  tieBreak: (left: Row, right: Row) => number;
}

/**
 * The next sort a click on `column` asks for. A column the table is not sorted
 * by starts in its own reading direction, a second click reverses it, and a
 * third gives the table back its opening order.
 */
export function nextColumnSort<Column extends string, Row>({
  current,
  column,
  rules,
}: {
  current: ColumnSortState<Column>;
  column: Column;
  rules: ColumnSortRules<Column, Row>;
}): ColumnSortState<Column> {
  const initial = rules.initialDirection[column];
  if (current.column !== column) return { column, direction: initial };
  if (current.direction === initial) {
    return { column, direction: initial === "asc" ? "desc" : "asc" };
  }
  return rules.defaultSort;
}

/**
 * One column's comparison. A row the column does not apply to sinks to the
 * bottom whichever way the column is read: flipping the direction is a request
 * to reverse the values, not to promote the rows that have none.
 */
function compareByColumn<Column extends string, Row>({
  left,
  right,
  sort,
  rules,
}: {
  left: Row;
  right: Row;
  sort: ColumnSortState<Column>;
  rules: ColumnSortRules<Column, Row>;
}): number {
  const a = rules.keyOf[sort.column](left);
  const b = rules.keyOf[sort.column](right);
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  const sign = sort.direction === "asc" ? 1 : -1;
  if (typeof a === "string" || typeof b === "string") {
    return String(a).localeCompare(String(b)) * sign;
  }
  return (a - b) * sign;
}

/**
 * The rows in the order the table draws them, leaving the caller's array
 * untouched. Every column falls back to the table's tie break, so two rows a
 * column cannot tell apart still read in the order the page opened in.
 */
export function sortRowsByColumn<Column extends string, Row, T extends Row>({
  rows,
  sort,
  rules,
}: {
  rows: readonly T[];
  sort: ColumnSortState<Column>;
  rules: ColumnSortRules<Column, Row>;
}): T[] {
  return [...rows].sort((left, right) => {
    const byColumn = compareByColumn({ left, right, sort, rules });
    if (byColumn !== 0) return byColumn;
    return rules.tieBreak(left, right);
  });
}

/**
 * The sorted rows, the order in force, and the click that changes it. `rules`
 * is read on every sort, so hand in a module-level constant rather than an
 * object built during render.
 */
export function useColumnSort<Column extends string, Row, T extends Row>({
  rows,
  rules,
}: {
  rows: readonly T[];
  rules: ColumnSortRules<Column, Row>;
}): {
  sorted: T[];
  sort: ColumnSortState<Column>;
  onSort: (column: Column) => void;
} {
  const [sort, setSort] = useState<ColumnSortState<Column>>(rules.defaultSort);

  const sorted = useMemo(() => sortRowsByColumn({ rows, sort, rules }), [rows, sort, rules]);

  const onSort = useCallback(
    (column: Column) => setSort((current) => nextColumnSort({ current, column, rules })),
    [rules],
  );

  return { sorted, sort, onSort };
}
