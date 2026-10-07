/**
 * What the Dashboards sidebar lists, each board in exactly one group: under "Your
 * dashboards" My dashboard then the team's unstarred boards by name, then the member's
 * stars in their own order, then the From LangWatch boards not starred. Pure.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import type { DashboardStar } from "@langwatch/dashboard-contract";

import { isOthersDashboard, myDashboardId } from "./boards.ts";
import type { CuratedBoard } from "./curated-boards.ts";

/** A stored board, as much of it as the sidebar reads. */
export interface SidebarBoard {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdById: string | null;
}

/** One of the member's stars as the server answers it, in their order. */
export type MemberStar =
  | { readonly kind: "board"; readonly board: SidebarBoard }
  | { readonly kind: "template"; readonly templateId: string };

/** A starred row: a stored board, or a From LangWatch board. */
export type StarredRow =
  | { readonly kind: "board"; readonly board: SidebarBoard }
  | { readonly kind: "template"; readonly curated: CuratedBoard };

export interface SidebarGroups {
  readonly myBoard: SidebarBoard | undefined;
  readonly yourBoards: readonly SidebarBoard[];
  readonly starred: readonly StarredRow[];
  readonly fromLangWatch: readonly CuratedBoard[];
}

/** The reference a star is written with. */
export function starRefOf(star: MemberStar | StarredRow): DashboardStar {
  if (star.kind === "board") return { kind: "board", dashboardId: star.board.id };
  return {
    kind: "template",
    templateId: "templateId" in star ? star.templateId : star.curated.templateId,
  };
}

/** Whether two references name the same star. */
export function sameStar(left: DashboardStar, right: DashboardStar): boolean {
  if (left.kind === "board" && right.kind === "board")
    return left.dashboardId === right.dashboardId;
  if (left.kind === "template" && right.kind === "template") {
    return left.templateId === right.templateId;
  }
  return false;
}

export function sidebarGroups({
  boards,
  stars,
  curated,
  userId,
}: {
  boards: readonly SidebarBoard[];
  stars: readonly MemberStar[];
  curated: readonly CuratedBoard[];
  userId: string | undefined;
}): SidebarGroups {
  const myId = myDashboardId({ boards, userId });
  const starredBoardIds = new Set(
    stars.flatMap((star) => (star.kind === "board" ? [star.board.id] : [])),
  );
  const starredTemplateIds = new Set(
    stars.flatMap((star) => (star.kind === "template" ? [star.templateId] : [])),
  );
  const curatedById = new Map(curated.map((board) => [board.templateId, board]));

  const starred = stars.flatMap((star): StarredRow[] => {
    if (star.kind === "board") return star.board.id === myId ? [] : [star];
    const board = curatedById.get(star.templateId);
    return board ? [{ kind: "template", curated: board }] : [];
  });

  return {
    myBoard: boards.find(({ id }) => id === myId),
    yourBoards: boards
      .filter(
        (board) =>
          board.id !== myId &&
          !starredBoardIds.has(board.id) &&
          !isOthersDashboard({ board, userId }),
      )
      .toSorted((a, b) => a.name.localeCompare(b.name)),
    starred,
    fromLangWatch: curated.filter(({ templateId }) => !starredTemplateIds.has(templateId)),
  };
}
