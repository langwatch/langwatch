/**
 * A product sidebar's Dashboards section with the organization's area on (ADR-002, decision 8):
 * the product's boards, its starred ones and its From LangWatch boards, each board in one group.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import type { DashboardHomeProduct } from "@langwatch/dashboard-contract";

import type { CuratedBoard } from "./curated-boards.ts";
import { isOwnMyDashboard, type LibraryBoard, libraryBoardPath } from "./organization-library.ts";

/** Boards the section shows before the rest sit behind "Show N more". */
export const PRODUCT_BOARDS_SHOWN_MAX = 8;

/** Every From LangWatch board is homed in LLM Ops (owner decision D5). */
const CURATED_HOME_PRODUCT: DashboardHomeProduct = "llm-ops";

/** The boards a starred group lists: every one in the library, else those homed elsewhere. */
export function boardsHomedOutside({
  boards,
  product,
}: {
  boards: readonly LibraryBoard[];
  product: DashboardHomeProduct | undefined;
}): LibraryBoard[] {
  if (product === void 0) return [...boards];
  return boards.filter((board) => board.homeProduct !== product);
}

/** Whether a sidebar's starred group lists starred From LangWatch boards: not in their home. */
export function listsStarredCurated(product: DashboardHomeProduct | undefined): boolean {
  return product !== CURATED_HOME_PRODUCT;
}

/** The section's groups; a board sits in exactly one. */
export type ProductSidebarBoards = {
  /** The member's own My dashboard, then the boards not starred, by name. */
  readonly rows: readonly LibraryBoard[];
  /** The product's other starred boards, in the member's star order. */
  readonly starred: readonly LibraryBoard[];
  /** The product's From LangWatch boards the member starred, in star order. */
  readonly starredCurated: readonly CuratedBoard[];
  /** The product's From LangWatch boards not starred. */
  readonly fromLangWatch: readonly CuratedBoard[];
};

/** The section's groups for one product, as the prototype's sidebar orders them. */
export function productSidebarBoards({
  boards,
  product,
  userId,
  curated,
  starredTemplateIds,
  hasProject,
}: {
  /** Every board the library lists; the product's own are picked here. */
  boards: readonly LibraryBoard[];
  product: DashboardHomeProduct;
  userId: string | undefined;
  curated: readonly CuratedBoard[];
  starredTemplateIds: readonly string[];
  /** A From LangWatch board reads the project in view, so with none it opens nowhere. */
  hasProject: boolean;
}): ProductSidebarBoards {
  const opening = boards.filter(
    (board) => board.homeProduct === product && libraryBoardPath(board) !== void 0,
  );
  const isDefault = (board: LibraryBoard) => isOwnMyDashboard({ board, userId });
  const defaults = opening.filter(isDefault);
  const others = opening
    .filter((board) => !isDefault(board) && board.starPosition === null)
    .toSorted((a, b) => a.name.localeCompare(b.name));
  const starred = opening
    .flatMap((board) =>
      isDefault(board) || board.starPosition === null ? [] : [{ board, at: board.starPosition }],
    )
    .toSorted((a, b) => a.at - b.at)
    .map(({ board }) => board);
  const productCurated = product === CURATED_HOME_PRODUCT && hasProject ? curated : [];
  const starredCurated = starredTemplateIds.flatMap((templateId) =>
    productCurated.filter((board) => board.templateId === templateId),
  );
  const fromLangWatch = productCurated.filter(
    (board) => !starredTemplateIds.includes(board.templateId),
  );
  return { rows: [...defaults, ...others], starred, starredCurated, fromLangWatch };
}

/** Whether the section has anything to list; with nothing it is hidden. */
export function hasProductBoards(boards: ProductSidebarBoards): boolean {
  const { rows, starred, starredCurated, fromLangWatch } = boards;
  return rows.length + starred.length + starredCurated.length + fromLangWatch.length > 0;
}

/** Who sees a board, as its row's icon says on hover. */
export function sharingTitle(board: Pick<LibraryBoard, "scope" | "project">): string {
  if (board.scope === "PRIVATE") return "Only you can see this";
  if (board.scope === "PROJECT" && board.project) return `Shared with ${board.project.name}`;
  return "Shared with the organization";
}
