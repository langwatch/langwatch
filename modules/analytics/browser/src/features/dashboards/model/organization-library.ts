/**
 * The organization's Dashboards library at `/dashboards` (ADR-002): every board the member can
 * see, grouped by the product that lists it. Pure, so the screen and its tests read one rule.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import {
  type DashboardHomeProduct,
  type DashboardProject,
  type DashboardScope,
  type DashboardStar,
} from "@langwatch/dashboard-contract";

import { MY_DASHBOARD_NAME, organizationBoardPath, organizationCuratedPath } from "./boards.ts";
import type { CuratedBoard } from "./curated-boards.ts";

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
  /** The author's display name; null when unknown. */
  readonly ownerName: string | null;
  readonly scope: DashboardScope;
  /** The product whose sidebar lists it. */
  readonly homeProduct: DashboardHomeProduct;
  /** The owning project, named only where the member may read it. */
  readonly project: DashboardProject | null;
  /** Where the board opens; null when no project the member reads can show it. */
  readonly openProject: DashboardProject | null;
  /** Its place in the member's star order; null when not starred. */
  readonly starPosition: number | null;
};

/** The fields a row reads off the list's answer, which carries more. */
export function libraryBoardOf({
  id,
  name,
  description,
  createdById,
  ownerName,
  scope,
  homeProduct,
  project,
  openProject,
  starPosition,
}: LibraryBoard): LibraryBoard {
  return {
    id,
    name,
    description,
    createdById,
    ownerName,
    scope,
    homeProduct,
    project,
    openProject,
    starPosition,
  };
}

/** Each home product as the rest of the app names it. */
export const HOME_PRODUCT_LABELS: Readonly<Record<DashboardHomeProduct, string>> = {
  "llm-ops": "LLM Ops",
  me: "Coding agents",
  gateway: "Gateway",
  governance: "Governance",
};

/** One product's group: its From LangWatch boards first, then its boards. */
export type LibraryGroup = {
  readonly product: DashboardHomeProduct;
  readonly label: string;
  readonly curated: readonly CuratedBoard[];
  readonly boards: readonly LibraryBoard[];
};

/** Boards with no project named first, then by project name, then by board name. */
export function byPlace(a: LibraryBoard, b: LibraryBoard): number {
  const projectOf = (board: LibraryBoard) => board.project?.name ?? "";
  return projectOf(a).localeCompare(projectOf(b)) || a.name.localeCompare(b.name);
}

/** The library's group order: the prototype's rail (its `PRODUCTS`, lib/nav/spaces.ts). */
export const LIBRARY_PRODUCT_ORDER: readonly DashboardHomeProduct[] = [
  "me",
  "llm-ops",
  "gateway",
  "governance",
];

/**
 * The library's groups in rail order, each product with at least one board. Every From
 * LangWatch board is homed in LLM Ops (ADR-002, decision 8).
 */
export function libraryGroups({
  boards,
  curated,
}: {
  boards: readonly LibraryBoard[];
  curated: readonly CuratedBoard[];
}): LibraryGroup[] {
  return LIBRARY_PRODUCT_ORDER.map((product) => ({
    product,
    label: HOME_PRODUCT_LABELS[product],
    curated: product === "llm-ops" ? curated : [],
    boards: boards.filter((board) => board.homeProduct === product).toSorted(byPlace),
  })).filter((group) => group.curated.length + group.boards.length > 0);
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

/**
 * The member's board stars with `board` swapped one place up or down, in star order, for
 * `boards.reorderStars`; undefined when it already sits at the end it faces.
 */
export function starOrderAfterMove({
  boards,
  board,
  direction,
}: {
  boards: readonly LibraryBoard[];
  board: Pick<LibraryBoard, "id">;
  direction: "up" | "down";
}): DashboardStar[] | undefined {
  const starred = starredInOrder(boards);
  const from = starred.findIndex((candidate) => candidate.id === board.id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= starred.length) return void 0;
  const swapped = starred.map((candidate, index) => {
    if (index === from) return starred[to] ?? candidate;
    return index === to ? (starred[from] ?? candidate) : candidate;
  });
  return swapped.map(({ id }) => ({ kind: "board", dashboardId: id }));
}

/** The member's starred boards in their star order. */
export function starredInOrder(boards: readonly LibraryBoard[]): LibraryBoard[] {
  return boards
    .filter((board) => board.starPosition !== null)
    .toSorted((a, b) => (a.starPosition ?? 0) - (b.starPosition ?? 0));
}

/** A group's heading: the product and how many boards it lists, From LangWatch ones included. */
export function groupHeading(group: LibraryGroup): string {
  return `${group.label} · ${group.curated.length + group.boards.length}`;
}

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

/** The member's own My dashboard, which keeps its name and is never deleted. */
export function isOwnMyDashboard({
  board,
  userId,
}: {
  board: Pick<LibraryBoard, "name" | "createdById">;
  userId: string | undefined;
}): boolean {
  return board.name === MY_DASHBOARD_NAME && userId !== void 0 && board.createdById === userId;
}

/** The first "Untitled dashboard N" no board in the project has taken. */
export function firstUntitledName(taken: readonly string[]): string {
  const names = new Set(taken);
  const candidates = Array.from(
    { length: names.size + 1 },
    (_, index) => `Untitled dashboard ${index + 1}`,
  );
  return candidates.find((name) => !names.has(name)) ?? `Untitled dashboard ${names.size + 1}`;
}

/** Stars the organization's sidebar shows before the rest sit behind "All starred (N)". */
export const STARRED_SHOWN_MAX = 7;

/** One row of the organization sidebar's "Starred dashboards" group: a plain link. */
export type StarredLibraryLink = {
  readonly key: string;
  readonly name: string;
  readonly href: string;
};

/**
 * The member's stars at the organization level: starred boards in their star order, then the
 * From LangWatch boards starred in the project in view. A board that opens nowhere is left out.
 */
export function organizationStarLinks({
  boards,
  templateIds,
  curated,
  hasProject,
}: {
  boards: readonly LibraryBoard[];
  templateIds: readonly string[];
  curated: readonly CuratedBoard[];
  /** A From LangWatch board reads the project in view, so with none it opens nowhere. */
  hasProject: boolean;
}): StarredLibraryLink[] {
  const starredBoards = starredInOrder(boards).flatMap((board): StarredLibraryLink[] => {
    const href = libraryBoardPath(board);
    return href ? [{ key: `board:${board.id}`, name: board.name, href }] : [];
  });
  if (!hasProject) return starredBoards;
  const starredCurated = templateIds.flatMap((templateId): StarredLibraryLink[] => {
    const board = curated.find((candidate) => candidate.templateId === templateId);
    if (!board) return [];
    const href = organizationCuratedPath({ templateId });
    return [{ key: `template:${templateId}`, name: board.name, href }];
  });
  return [...starredBoards, ...starredCurated];
}
