import {
  EXPERIMENT_TYPE_LABELS,
  experimentTypeLabel,
  RUN_STATUS_LABELS,
  runStatusOf,
  datasetOfRow,
  type ExperimentListRow,
  type RunStatus,
} from "./experiment-list-row.ts";

/** What the toolbar narrows the list by. */
export type ListFilters = {
  query: string;
  /** "Ran via" labels; empty means every kind. */
  kinds: string[];
  /** Latest-run states; empty means every state. */
  statuses: FilterableStatus[];
};

export type FilterableStatus = Exclude<RunStatus, "none">;

/** How the list is grouped: not at all, or by how each experiment ran. */
export type ListGrouping = "none" | "kind";

export const NO_FILTERS: ListFilters = { query: "", kinds: [], statuses: [] };

export const STATUS_OPTIONS: { value: FilterableStatus; label: string }[] = (
  ["running", "completed", "stopped"] as const
).map((value) => ({ value, label: RUN_STATUS_LABELS[value] }));

/** Search text, a kind or a state is active: the list is then filtered here, not on the server. */
export const isNarrowed = (filters: ListFilters): boolean =>
  filters.query.trim() !== "" || filters.kinds.length > 0 || filters.statuses.length > 0;

/** The four kinds of experiment, then any other label the loaded rows carry (legacy tasks). */
export function kindOptions(rows: ExperimentListRow[]): string[] {
  const known = Object.values(EXPERIMENT_TYPE_LABELS);
  const extra = rows.map(experimentTypeLabel).filter((label) => !known.includes(label));
  return [...known, ...new Set(extra)];
}

function matchesQuery(row: ExperimentListRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return [row.name ?? "", row.slug, datasetOfRow(row)?.name ?? "", experimentTypeLabel(row)].some(
    (text) => text.toLowerCase().includes(needle),
  );
}

/** Rows that match the search text, the kinds and the latest run's state, in their given order. */
export function filterExperiments({
  rows,
  filters,
  nowMs,
}: {
  rows: ExperimentListRow[];
  filters: ListFilters;
  nowMs: number;
}): ExperimentListRow[] {
  return rows.filter((row) => {
    if (!matchesQuery(row, filters.query)) return false;
    if (filters.kinds.length > 0 && !filters.kinds.includes(experimentTypeLabel(row))) return false;
    if (filters.statuses.length === 0) return true;
    const status = runStatusOf({ runsSummary: row.runsSummary, nowMs });
    return status !== "none" && filters.statuses.includes(status);
  });
}

export type ExperimentGroup = { key: string; rows: ExperimentListRow[] };

/** Rows grouped by how they ran, the biggest group first; ties keep the order of first sight. */
export function groupByKind(rows: ExperimentListRow[]): ExperimentGroup[] {
  const groups = new Map<string, ExperimentListRow[]>();
  for (const row of rows) {
    const key = experimentTypeLabel(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups]
    .map(([key, grouped]) => ({ key, rows: grouped }))
    .toSorted((a, b) => b.rows.length - a.rows.length);
}

/** One page of an already filtered list. */
export const pageOf = <T>({
  rows,
  page,
  pageSize,
}: {
  rows: T[];
  page: number;
  pageSize: number;
}) => rows.slice((page - 1) * pageSize, page * pageSize);
