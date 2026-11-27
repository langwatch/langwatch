/**
 * The organization's Dashboards library at `/dashboards` (ADR-002): every board the member can
 * see, grouped by the product that lists it. Pure, so the screen and its tests read one rule.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import {
  type DashboardHomeProduct,
  type DashboardProject,
  type DashboardScope,
  isMyDashboardOf,
} from "@langwatch/dashboard-contract";

import { organizationBoardPath, untitledBoardName } from "./boards.ts";

/** What the library's header says it is. */
export const LIBRARY_HEADER = {
  title: "Dashboards",
  hint: "Every dashboard you can see, by product.",
} as const;

/** One board as the library lists it, from `boards.listInOrganization`. */
export type LibraryBoard = {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdById: string | null;
  /** Set to the reader's id on their own My dashboard; absent from an older server. */
  readonly myDashboardOfUserId?: string | null;
  /** The author's display name; null when unknown. */
  readonly ownerName: string | null;
  readonly scope: DashboardScope;
  /** The product whose sidebar lists it. */
  readonly homeProduct: DashboardHomeProduct;
  /** The owning project, named only where the member may read it. */
  readonly project: DashboardProject | null;
  /** Where the board opens; null when no project the member reads can show it. */
  readonly openProject: DashboardProject | null;
  /** ISO 8601 off the wire, so it sorts as text. */
  readonly updatedAt: string;
};

/** The fields a row reads off the list's answer, which carries more. */
export function libraryBoardOf({
  id,
  name,
  description,
  createdById,
  myDashboardOfUserId,
  ownerName,
  scope,
  homeProduct,
  project,
  openProject,
  updatedAt,
}: LibraryBoard): LibraryBoard {
  return {
    id,
    name,
    description,
    createdById,
    myDashboardOfUserId,
    ownerName,
    scope,
    homeProduct,
    project,
    openProject,
    updatedAt,
  };
}

/** Each home product as the rest of the app names it. */
export const HOME_PRODUCT_LABELS: Readonly<Record<DashboardHomeProduct, string>> = {
  "llm-ops": "LLM Ops",
  me: "Coding agents",
  gateway: "Gateway",
  governance: "Governance",
};

/** Boards with no project named first, then by project name, then by board name. */
export function byPlace(a: LibraryBoard, b: LibraryBoard): number {
  const projectOf = (board: LibraryBoard) => board.project?.name ?? "";
  return projectOf(a).localeCompare(projectOf(b)) || a.name.localeCompare(b.name);
}

/** The library's product order: the prototype's rail (its `PRODUCTS`, lib/nav/spaces.ts). */
export const LIBRARY_PRODUCT_ORDER: readonly DashboardHomeProduct[] = [
  "me",
  "llm-ops",
  "gateway",
  "governance",
];

/** The library's rows before a header is pressed: by product in rail order, then by place. */
export function libraryRows({ boards }: { boards: readonly LibraryBoard[] }): LibraryBoard[] {
  const rank = (board: LibraryBoard) => LIBRARY_PRODUCT_ORDER.indexOf(board.homeProduct);
  return boards.toSorted((a, b) => rank(a) - rank(b) || byPlace(a, b));
}

/** The names boards homed in `product` already have, so a new one is numbered past them. */
export function namesInProduct({
  boards,
  product,
}: {
  boards: readonly LibraryBoard[];
  product: DashboardHomeProduct;
}): string[] {
  return boards.filter((board) => board.homeProduct === product).map((board) => board.name);
}

/** Who sees a new board unless the member picks: a project's team, only me, or everyone. */
export const DEFAULT_SCOPE_BY_PRODUCT: Readonly<Record<DashboardHomeProduct, DashboardScope>> = {
  "llm-ops": "PROJECT",
  me: "PRIVATE",
  gateway: "ORGANIZATION",
  governance: "ORGANIZATION",
};

/** Who sees a board, as its row says it: the project, "Organization" or "Only me". */
export function whoSees(board: Pick<LibraryBoard, "scope" | "project">): string {
  if (board.scope === "PRIVATE") return "Only me";
  if (board.scope === "PROJECT" && board.project) return board.project.name;
  return "Organization";
}

/** The board's owner as its row names it: "You" for the member's own, else the author's name. */
export function ownerLabel({
  board,
  userId,
}: {
  board: Pick<LibraryBoard, "createdById" | "ownerName">;
  userId: string | undefined;
}): string | undefined {
  if (userId !== void 0 && board.createdById === userId) return "You";
  return board.ownerName ?? void 0;
}

/**
 * Where the board opens: the organization's address, whatever its scope (ADR-002, decision 4);
 * nowhere when no project the member reads shows it.
 */
export function libraryBoardPath(board: LibraryBoard): string | undefined {
  if (!board.openProject) return void 0;
  return organizationBoardPath({ dashboardId: board.id });
}

type MyDashboardFields = Pick<LibraryBoard, "name" | "createdById" | "myDashboardOfUserId">;

/** The member's own My dashboard, which is never deleted. */
export function isOwnMyDashboard({
  board,
  userId,
}: {
  board: MyDashboardFields;
  userId: string | undefined;
}): boolean {
  return isMyDashboardOf({ board, userId });
}

/**
 * Whether a board may be renamed, wherever Rename is offered (a library row, a sidebar row, the
 * board's title): by the member's edit grant in the project that owns it. My dashboard too, once
 * it is marked theirs: before that, a new name would make it an ordinary board (AC163).
 */
export function mayRenameBoard({
  board,
  userId,
  mayEditInOwner,
}: {
  board: MyDashboardFields;
  userId: string | undefined;
  /** `analytics:update` in the project that owns the board. */
  mayEditInOwner: boolean;
}): boolean {
  const isUnmarkedMyDashboard =
    isOwnMyDashboard({ board, userId }) && board.myDashboardOfUserId !== userId;
  return mayEditInOwner && !isUnmarkedMyDashboard;
}

/** "Move to product…": `onMove` where the member may move it, else why not, shown disabled. */
export type BoardMenuMove = { onMove: () => void } | { refusal: string };

/** What a board's "⋮" menu offers; an entry left out is not shown. */
export type BoardMenuActions = {
  onRename?: () => void;
  move?: BoardMenuMove;
  onDuplicate?: () => void;
  /** "Duplicate to edit" on a board the member cannot edit. */
  duplicateLabel?: string;
  /** `onDelete` is absent for My dashboard, whose Delete shows disabled. */
  remove?: { onDelete?: () => void };
};

/** What each menu entry does when chosen. */
export type BoardMenuHandlers = {
  rename: () => void;
  move: () => void;
  /** Unset where there is no store project to copy into. */
  duplicate: (() => void) | undefined;
  delete: () => void;
};

/** Why a board the member may only view offers no move. */
const VIEW_ONLY_MOVE_REFUSAL = "You can view this dashboard but not change it.";

/**
 * A board's menu, in the library and the product sidebars alike, from the member's grants in
 * the project that owns it. My dashboard shows Delete disabled; a board that
 * opens nowhere cannot be copied; one the member cannot edit shows Move disabled.
 */
export function boardMenuActions({
  board,
  userId,
  mayEditInOwner,
  mayDeleteInOwner,
  on,
}: {
  board: LibraryBoard;
  userId: string | undefined;
  /** `analytics:update` in the project that owns the board. */
  mayEditInOwner: boolean;
  /** `analytics:delete` in the project that owns the board. */
  mayDeleteInOwner: boolean;
  on: BoardMenuHandlers;
}): BoardMenuActions {
  const duplicate = board.openProject !== null ? on.duplicate : void 0;
  const duplicateLabel = mayEditInOwner ? "Duplicate" : "Duplicate to edit";
  const remove = isOwnMyDashboard({ board, userId }) ? {} : { onDelete: on.delete };
  return {
    ...(mayRenameBoard({ board, userId, mayEditInOwner }) ? { onRename: on.rename } : {}),
    move: mayEditInOwner ? { onMove: on.move } : { refusal: VIEW_ONLY_MOVE_REFUSAL },
    ...(duplicate ? { onDuplicate: duplicate, duplicateLabel } : {}),
    ...(mayDeleteInOwner ? { remove } : {}),
  };
}

/** The first "Untitled dashboard N" no board in `taken` has, as a new draft is named. */
export function firstUntitledName(taken: readonly string[]): string {
  return untitledBoardName({ takenNames: taken });
}
