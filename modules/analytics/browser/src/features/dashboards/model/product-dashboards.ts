/**
 * A product sidebar's Dashboards section with the organization's area on (ADR-002, decision 8):
 * the product's boards and its From LangWatch boards; stars no longer place a board.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import type { DashboardHomeProduct } from "@langwatch/dashboard-contract";

import type { CuratedBoard } from "./curated-boards.ts";
import { isOwnMyDashboard, type LibraryBoard, libraryBoardPath } from "./organization-library.ts";

/** Boards the section shows before the rest sit behind "Show N more". */
export const PRODUCT_BOARDS_SHOWN_MAX = 8;

/** Every From LangWatch board is homed in LLM Ops (owner decision D5). */
const CURATED_HOME_PRODUCT: DashboardHomeProduct = "llm-ops";

/** The section's groups; a board sits in exactly one. */
export type ProductSidebarBoards = {
  /** The member's own My dashboard, then the product's other boards, by name. */
  readonly rows: readonly LibraryBoard[];
  /** The product's From LangWatch boards. */
  readonly fromLangWatch: readonly CuratedBoard[];
};

/**
 * The section's groups for one product: every board homed there the member can see for the
 * project in view, whatever its scope. A Project board of another project is not in view.
 */
export function productSidebarBoards({
  boards,
  product,
  userId,
  curated,
  projectId,
}: {
  /** Every board the library lists; the product's own are picked here. */
  boards: readonly LibraryBoard[];
  product: DashboardHomeProduct;
  userId: string | undefined;
  curated: readonly CuratedBoard[];
  /** The project in view; a From LangWatch board reads it, so with none it opens nowhere. */
  projectId: string | undefined;
}): ProductSidebarBoards {
  const listed = boards.filter(
    (board) =>
      board.homeProduct === product &&
      libraryBoardPath(board) !== void 0 &&
      (board.scope !== "PROJECT" || board.project?.id === projectId),
  );
  const isDefault = (board: LibraryBoard) => isOwnMyDashboard({ board, userId });
  const others = listed
    .filter((board) => !isDefault(board))
    .toSorted((a, b) => a.name.localeCompare(b.name));
  const hasProject = projectId !== void 0;
  return {
    rows: [...listed.filter(isDefault), ...others],
    fromLangWatch: product === CURATED_HOME_PRODUCT && hasProject ? curated : [],
  };
}

/** Who sees a board, as its row's icon says on hover. */
export function sharingTitle(board: Pick<LibraryBoard, "scope" | "project">): string {
  if (board.scope === "PRIVATE") return "Only you can see this";
  if (board.scope === "PROJECT" && board.project) return `Shared with ${board.project.name}`;
  return "Shared with the organization";
}
