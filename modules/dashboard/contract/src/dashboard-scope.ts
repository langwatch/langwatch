/**
 * Every rule that follows from a board's scope: who sees it from where, who may write it, who
 * may change the scope and what a change costs other people. Pure, so the server refuses with
 * the same rules the browser offers controls with. Spec: dashboards-v2.feature AC170 to AC189.
 */
import {
  DEFAULT_DASHBOARD_SCOPE,
  MY_DASHBOARD_NAME,
  type Dashboard,
  type DashboardScope,
  type DashboardViewer,
} from "./dashboard.ts";

/** What the rules read of a board. */
export type ScopedDashboard = Pick<
  Dashboard,
  "scope" | "projectId" | "organizationId" | "createdById"
>;

/** Where a board is read from: the project in the address, and its organization when known. */
export type DashboardPlace = Readonly<{ projectId: string; organizationId: string | undefined }>;

/** The reader and where they stand; no viewer is a project credential. */
type Reading = Readonly<{ viewer: DashboardViewer | undefined; place: DashboardPlace }>;

/**
 * How a reader stands to a board: "home" in the project that owns it, a "guest" where an
 * Organization board is shown in another project of its organization, or "none".
 */
export type DashboardStanding = "home" | "guest" | "none";

/**
 * The scope a new board starts at: Project, and Only me for a member's own My dashboard where
 * Dashboards is switched on. Where it is off nothing offers the scope, so nobody could widen it.
 */
export function newDashboardScope({
  name,
  createdById,
  dashboardsEnabled,
}: {
  name: string;
  createdById: string | undefined;
  dashboardsEnabled: boolean;
}): DashboardScope {
  const ownMyDashboard = name === MY_DASHBOARD_NAME && createdById !== undefined;
  return ownMyDashboard && dashboardsEnabled ? "PRIVATE" : DEFAULT_DASHBOARD_SCOPE;
}

/** A board with no recorded author has none: a project credential never is one. */
export function isDashboardAuthor({
  board,
  viewer,
}: {
  board: Pick<Dashboard, "createdById">;
  viewer: DashboardViewer | undefined;
}): boolean {
  return viewer !== undefined && board.createdById !== null && board.createdById === viewer.userId;
}

export function dashboardStanding({
  board,
  viewer,
  place,
}: Reading & { board: ScopedDashboard }): DashboardStanding {
  if (board.projectId === place.projectId) {
    const hidden = board.scope === "PRIVATE" && !isDashboardAuthor({ board, viewer });
    return hidden ? "none" : "home";
  }

  const shared =
    board.scope === "ORGANIZATION" &&
    board.organizationId !== null &&
    board.organizationId === place.organizationId;
  return shared ? "guest" : "none";
}

/**
 * The boards a reader's Dashboards lists in one project: the project's own they may see, then
 * the organization's from other projects.
 */
export function dashboardsListedFor<Board extends ScopedDashboard>({
  boards,
  viewer,
  place,
}: Reading & { boards: readonly Board[] }): { home: Board[]; guests: Board[] } {
  const standing = (board: Board) => dashboardStanding({ board, viewer, place });
  return {
    home: boards.filter((board) => standing(board) === "home"),
    guests: boards.filter((board) => standing(board) === "guest"),
  };
}

/** Why a reader cannot change a board's scope; "none" when they can. */
export type DashboardScopeLock = "none" | "guest" | "not-author" | "no-permission";

/**
 * Who sees a board is its author's call alone, made in the project that owns it. `mayEdit` is
 * the analytics edit permission, which the door asks; a project administrator gets no more.
 */
export function dashboardScopeLock({
  board,
  viewer,
  place,
  mayEdit,
}: Reading & { board: ScopedDashboard; mayEdit: boolean }): DashboardScopeLock {
  if (dashboardStanding({ board, viewer, place }) !== "home") return "guest";
  if (!isDashboardAuthor({ board, viewer })) return "not-author";
  return mayEdit ? "none" : "no-permission";
}

/** Who stops seeing a board when its scope goes from one level to another. */
export function dashboardScopeLoss({ from, to }: { from: DashboardScope; to: DashboardScope }): {
  teammates: boolean;
  otherProjects: boolean;
} {
  return {
    teammates: from !== "PRIVATE" && to === "PRIVATE",
    otherProjects: from === "ORGANIZATION" && to !== "ORGANIZATION",
  };
}

/**
 * Whether a change of scope asks first: only when someone loses the board. Leaving the
 * organization always does; Project to Only me does when somebody else starred it.
 */
export function dashboardScopeChangeAsksFirst({
  from,
  to,
  otherStars,
}: {
  from: DashboardScope;
  to: DashboardScope;
  otherStars: number;
}): boolean {
  const loss = dashboardScopeLoss({ from, to });
  if (loss.otherProjects) return true;
  return loss.teammates && otherStars > 0;
}
