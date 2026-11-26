/**
 * A product sidebar's Dashboards section with the organization's area on (ADR-002, decision 8):
 * the product's boards; stars no longer place a board.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import type { DashboardHomeProduct } from "@langwatch/dashboard-contract";

import { curatedBoardPath, organizationCuratedBoardPath } from "./boards.ts";
import {
  type CuratedBoard,
  curatedBoardById,
  PRODUCT_DEFAULT_BOARD_IDS,
} from "./curated-boards.ts";
import { isOwnMyDashboard, type LibraryBoard, libraryBoardPath } from "./organization-library.ts";

/** Boards a sidebar section or library group shows before "Show N more". */
export const PRODUCT_BOARDS_SHOWN_MAX = 8;

/**
 * The section's rows for one product: every board homed there the member can see for the project
 * in view, whatever its scope, but no Project board or own My dashboard of another project, so
 * the member's own lists once. It comes first, then the rest by name.
 */
export function productSidebarBoards({
  boards,
  product,
  userId,
  projectId,
}: {
  /** Every board the library lists; the product's own are picked here. */
  boards: readonly LibraryBoard[];
  product: DashboardHomeProduct;
  userId: string | undefined;
  /** The project in view, whose Project boards are the ones listed. */
  projectId: string | undefined;
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
  const others = listed
    .filter((board) => !isDefault(board))
    .toSorted((a, b) => a.name.localeCompare(b.name));
  return [...listed.filter(isDefault), ...others];
}

/** The pinned row's words and address. */
export interface PinnedBoard {
  readonly templateId: string;
  readonly name: string;
  readonly href: string;
}

/**
 * The From LangWatch board a product's section pins above its own boards, or undefined where
 * the product pins none, or pins a project board while no project is in view.
 */
export function productDefaultBoard({
  product,
  projectSlug,
}: {
  product: DashboardHomeProduct;
  projectSlug: string | undefined;
}): PinnedBoard | undefined {
  const pinned = PRODUCT_DEFAULT_BOARD_IDS[product];
  const board: CuratedBoard | undefined = pinned && curatedBoardById(pinned.templateId);
  if (!pinned || !board) return undefined;
  if (pinned.at === "organization") {
    return {
      templateId: board.templateId,
      name: board.name,
      href: organizationCuratedBoardPath({ templateId: board.templateId }),
    };
  }
  if (projectSlug === undefined) return undefined;
  return {
    templateId: board.templateId,
    name: board.name,
    href: curatedBoardPath({ projectSlug, templateId: board.templateId }),
  };
}

/** Who sees a board, as its row's icon says on hover. */
export function sharingTitle(board: Pick<LibraryBoard, "scope" | "project">): string {
  if (board.scope === "PRIVATE") return "Only you can see this";
  if (board.scope === "PROJECT" && board.project) return `Shared with ${board.project.name}`;
  return "Shared with the organization";
}
