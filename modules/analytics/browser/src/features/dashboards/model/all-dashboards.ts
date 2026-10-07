/**
 * The All dashboards page's list: how a search narrows it and how a sort orders
 * it. Pure, so the page and its tests share one source of the ordering.
 */

/** A board as the page lists it; a superset is fine. */
export type ListedBoard = {
  id: string;
  name: string;
  description: string | null;
  /** ISO 8601 off the wire; its lexical order is its chronological order. */
  updatedAt: string;
};

/** The orders the page offers; "recently-updated" is the default. */
export const DASHBOARD_SORTS = ["recently-updated", "name"] as const;
export type DashboardSort = (typeof DASHBOARD_SORTS)[number];
export const DEFAULT_DASHBOARD_SORT: DashboardSort = "recently-updated";

export const DASHBOARD_SORT_LABELS: Readonly<Record<DashboardSort, string>> = {
  "recently-updated": "Recently updated",
  name: "Name",
};

/** The boards whose name or description holds every word of the search. */
export function filterDashboards<Board extends { name: string; description: string | null }>({
  boards,
  search,
}: {
  boards: readonly Board[];
  search: string;
}): Board[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...boards];
  return boards.filter((board) => {
    const haystack = `${board.name} ${board.description ?? ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** A new array ordered by the chosen sort; name ties break by name, A to Z. */
export function sortDashboards<Board extends ListedBoard>({
  boards,
  sort,
}: {
  boards: readonly Board[];
  sort: DashboardSort;
}): Board[] {
  if (sort === "name") {
    return boards.toSorted((left, right) => left.name.localeCompare(right.name));
  }
  // ISO 8601 strings compare chronologically, so newest-first is a reverse compare.
  return boards.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
