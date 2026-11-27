/**
 * The `/dashboards` library's search, filters and column sort, over the rows `libraryRows`
 * orders. Pure, so the screen and its tests read one rule.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import type { DashboardHomeProduct, DashboardScope } from "@langwatch/dashboard-contract";

import {
  HOME_PRODUCT_LABELS,
  LIBRARY_PRODUCT_ORDER,
  type LibraryBoard,
} from "./organization-library.ts";

/** Whose boards the library lists: anyone's, or only the ones the member made. */
export type LibraryOwnerFilter = "anyone" | "me";

/** What the library's toolbar narrows the list to. */
export type LibraryFilters = {
  readonly search: string;
  readonly product: DashboardHomeProduct | "all";
  readonly owner: LibraryOwnerFilter;
  readonly sharing: DashboardScope | "any";
};

export const NO_LIBRARY_FILTERS: LibraryFilters = {
  search: "",
  product: "all",
  owner: "anyone",
  sharing: "any",
};

/** "Created by" as the toolbar offers it. */
export const LIBRARY_OWNER_CHOICES: readonly { value: LibraryOwnerFilter; label: string }[] = [
  { value: "anyone", label: "Anyone" },
  { value: "me", label: "Me" },
];

/** "Shared with" as the toolbar offers it, in the words a row uses. */
export const LIBRARY_SHARING_CHOICES: readonly {
  value: LibraryFilters["sharing"];
  label: string;
}[] = [
  { value: "any", label: "Anyone" },
  { value: "PRIVATE", label: "Only me" },
  { value: "PROJECT", label: "Project" },
  { value: "ORGANIZATION", label: "Organization" },
];

/** Whether the toolbar narrows the list at all, so it offers "Clear filters". */
export function hasLibraryFilters(filters: LibraryFilters): boolean {
  return (
    filters.search.trim() !== "" ||
    filters.product !== "all" ||
    filters.owner !== "anyone" ||
    filters.sharing !== "any"
  );
}

/** Whether the search text is in the board's name, description, project or owner, any case. */
function matchesSearch({ board, search }: { board: LibraryBoard; search: string }): boolean {
  const needle = search.trim().toLocaleLowerCase();
  if (needle === "") return true;
  const texts = [board.name, board.description, board.project?.name, board.ownerName];
  return texts.some((text) => text?.toLocaleLowerCase().includes(needle) === true);
}

/** The boards the search and filters leave, in the order given. */
export function filterLibraryBoards({
  boards,
  filters,
  userId,
  except,
}: {
  boards: readonly LibraryBoard[];
  filters: LibraryFilters;
  userId: string | undefined;
  /** A filter left out, so its own chips can count what picking each would leave. */
  except?: keyof LibraryFilters;
}): LibraryBoard[] {
  const applies = (key: keyof LibraryFilters) => key !== except;
  const isMine = (board: LibraryBoard) => userId !== void 0 && board.createdById === userId;
  return boards.filter(
    (board) =>
      (!applies("search") || matchesSearch({ board, search: filters.search })) &&
      (!applies("product") || filters.product === "all" || board.homeProduct === filters.product) &&
      (!applies("owner") || filters.owner === "anyone" || isMine(board)) &&
      (!applies("sharing") || filters.sharing === "any" || board.scope === filters.sharing),
  );
}

/** One product chip: "All", or a product that has a board, with how many it would list. */
export type LibraryProductChip = {
  readonly value: DashboardHomeProduct | "all";
  readonly label: string;
  readonly count: number;
};

/** The product chips, each counting what it would list under the other filters. */
export function libraryProductChips({
  boards,
  filters,
  userId,
}: {
  boards: readonly LibraryBoard[];
  filters: LibraryFilters;
  userId: string | undefined;
}): LibraryProductChip[] {
  const narrowed = filterLibraryBoards({ boards, filters, userId, except: "product" });
  const products = LIBRARY_PRODUCT_ORDER.filter(
    (product) =>
      product === filters.product || boards.some((board) => board.homeProduct === product),
  );
  return [
    { value: "all", label: "All", count: narrowed.length },
    ...products.map((product) => ({
      value: product,
      label: HOME_PRODUCT_LABELS[product],
      count: narrowed.filter((board) => board.homeProduct === product).length,
    })),
  ];
}

/** A pressed column header: which column orders the rows, and which way. */
export type LibrarySort = {
  readonly column: "name" | "updated";
  readonly direction: "asc" | "desc";
};

/** The rows in a pressed header's order; with none pressed, as given. */
export function sortLibraryBoards({
  boards,
  sort,
}: {
  boards: readonly LibraryBoard[];
  sort: LibrarySort | undefined;
}): LibraryBoard[] {
  if (!sort) return [...boards];
  const sign = sort.direction === "asc" ? 1 : -1;
  const compare = (a: LibraryBoard, b: LibraryBoard) =>
    sort.column === "name" ? a.name.localeCompare(b.name) : a.updatedAt.localeCompare(b.updatedAt);
  return boards.toSorted((a, b) => sign * compare(a, b));
}

/** A header press: Name starts A to Z, Updated starts newest first, a second press flips it. */
export function nextLibrarySort({
  sort,
  column,
}: {
  sort: LibrarySort | undefined;
  column: LibrarySort["column"];
}): LibrarySort {
  if (sort?.column === column) {
    return { column, direction: sort.direction === "asc" ? "desc" : "asc" };
  }
  return { column, direction: column === "name" ? "asc" : "desc" };
}

/** What the toolbar says it shows: "2 of 5 dashboards". */
export function librarySummary({ shown, total }: { shown: number; total: number }): string {
  return `${shown} of ${total} ${total === 1 ? "dashboard" : "dashboards"}`;
}
