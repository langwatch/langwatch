/**
 * A product sidebar's Dashboards section with the organization's area on (ADR-002, decision 8):
 * the product's boards; stars no longer place a board.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import type { DashboardHomeProduct } from "@langwatch/dashboard-contract";

import { isOwnMyDashboard, type LibraryBoard, libraryBoardPath } from "./organization-library.ts";

/** Boards a sidebar section or library group shows before "Show N more". */
export const PRODUCT_BOARDS_SHOWN_MAX = 8;

/**
 * The section's rows for one product: every board homed there the member can see for the project
 * in view, but no Project board or own My dashboard of another project. My dashboard comes first,
 * then the boards the member's `order` names, in order, then the rest by name.
 */
export function productSidebarBoards({
  boards,
  product,
  userId,
  projectId,
  order = [],
}: {
  /** Every board the library lists; the product's own are picked here. */
  boards: readonly LibraryBoard[];
  product: DashboardHomeProduct;
  userId: string | undefined;
  /** The project in view, whose Project boards are the ones listed. */
  projectId: string | undefined;
  /** The member's own order of this section, as `boards.sidebarOrder` answers it. */
  order?: readonly string[];
}): readonly LibraryBoard[] {
  const isDefault = (board: LibraryBoard) => isOwnMyDashboard({ board, userId });
  const listsOnlyInItsProject = (board: LibraryBoard) =>
    board.scope === "PROJECT" || isDefault(board);
  const listed = boards.filter(
    (board) =>
      board.homeProduct === product &&
      libraryBoardPath(board) !== void 0 &&
      (!listsOnlyInItsProject(board) || board.project?.id === projectId),
  );
  const place = new Map(order.map((id, index) => [id, index]));
  const placeOf = (board: LibraryBoard) => place.get(board.id) ?? Number.POSITIVE_INFINITY;
  const others = listed
    .filter((board) => !isDefault(board))
    .toSorted((a, b) => placeOf(a) - placeOf(b) || a.name.localeCompare(b.name));
  return [...listed.filter(isDefault), ...others];
}

/**
 * The order to store once the member moved a board: the shown boards take the slots they held,
 * in their new order, and a shown board the stored order lacked goes last. An id the section does
 * not show (a Project board of another project) keeps its slot, so it never moves from here.
 */
export function nextSidebarOrder({
  stored,
  shown,
}: {
  stored: readonly string[];
  /** The section's movable boards' ids, in their new order. */
  shown: readonly string[];
}): string[] {
  const isShown = new Set(shown);
  const queue = [...shown];
  const kept = stored.flatMap((id) => {
    if (!isShown.has(id)) return [id];
    const next = queue.shift();
    return next === void 0 ? [] : [next];
  });
  return [...kept, ...queue];
}

/** Who sees a board, as its row's icon says on hover. */
export function sharingTitle(board: Pick<LibraryBoard, "scope" | "project">): string {
  if (board.scope === "PRIVATE") return "Only you can see this";
  if (board.scope === "PROJECT" && board.project) return `Shared with ${board.project.name}`;
  return "Shared with the organization";
}
