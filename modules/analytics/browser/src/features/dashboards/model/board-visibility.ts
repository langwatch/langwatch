/**
 * Who a board is shown to (AC18) and who may change that (AC26): the
 * creator or an admin, mirroring the server's `isDashboardManageable` so the
 * control is disabled before the server has to refuse. Pure.
 */

import { DASHBOARD_VISIBILITIES, type DashboardVisibility } from "@langwatch/dashboard-contract";

/** The grant the server treats as admin for a board. */
export const BOARD_ADMIN_PERMISSION = "project:manage";

const VISIBILITY_LABELS: Readonly<Record<DashboardVisibility, string>> = {
  only_me: "Only me",
  team: "Team",
  organisation: "Organisation",
};

export const BOARD_VISIBILITY_LOCKED_REASON =
  "Only the dashboard's creator or an admin can change who sees it.";

export function boardVisibilityLabel(visibility: DashboardVisibility): string {
  return VISIBILITY_LABELS[visibility];
}

/**
 * Who may change a board's visibility or delete it. A board with no recorded
 * creator predates the rule and stays open to anyone who may edit.
 */
export function canManageBoard({
  createdById,
  userId,
  isAdmin,
}: {
  createdById: string | null;
  userId: string | undefined;
  isAdmin: boolean;
}): boolean {
  if (createdById === null) return true;
  return createdById === userId || isAdmin;
}

/** A sidebar group of boards, labelled by who they are shown to. */
export interface BoardVisibilityGroup<Board> {
  readonly key: DashboardVisibility;
  readonly label: string;
  readonly boards: readonly Board[];
}

const GROUP_LABELS: Readonly<Record<DashboardVisibility, string>> = {
  only_me: "Mine",
  team: "Team",
  organisation: "Organisation",
};

/**
 * The prototype's sidebar groups, Mine then Team then Organisation, each
 * listed only when it has a board.
 */
export function boardVisibilityGroups<Board extends { visibility: DashboardVisibility }>(
  boards: readonly Board[],
): BoardVisibilityGroup<Board>[] {
  return DASHBOARD_VISIBILITIES.map((key) => ({
    key,
    label: GROUP_LABELS[key],
    boards: boards.filter((board) => board.visibility === key),
  })).filter((group) => group.boards.length > 0);
}
