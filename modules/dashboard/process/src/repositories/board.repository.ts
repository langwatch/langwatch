import type {
  Board,
  DashboardScope,
  DashboardStar,
  StarredDashboard,
} from "@langwatch/dashboard-contract";

/** A Dashboards board as DashboardsV2 stores it; `order` is always 0, since stars order them. */
export type BoardRecord = Board;

/** The stored summary: `graphCount` is its widgets; stars and the owner are per reader. */
export type BoardSummaryRecord = Board & { graphCount: number };

/** The editable fields of a stored board; an absent key is left as it is. */
export type BoardUpdate = Readonly<{
  name?: string;
  description?: string | null;
  createdById?: string;
  scope?: DashboardScope;
  organizationId?: string;
  /** `null` returns the board to its default. */
  excludedOrigins?: readonly string[] | null;
}>;

/**
 * The project a read is made from. With `organization` the read also reaches the Organization
 * boards its other live projects own; the caller names those projects (AC188).
 */
export type BoardReach = Readonly<{
  projectId: string;
  organization?: Readonly<{ organizationId: string; liveProjectIds: readonly string[] }>;
}>;

/**
 * One member's stars as one project lists them. `sharedProjectIds` names the other projects
 * whose boards this project lists; the caller passes live projects only.
 */
export type MemberStars = Readonly<{
  projectId: string;
  userId: string;
  sharedProjectIds?: readonly string[];
}>;

/**
 * The Dashboards area's boards (DashboardsV2) and each member's stars on them. A write naming a
 * board the project does not own is refused; a read answers absence.
 */
export interface BoardRepository {
  /** The project's boards, oldest first, then the organization's from other projects. */
  findBoards(input: BoardReach): Promise<BoardSummaryRecord[]>;
  /** The boards among these ids the read reaches; an id it does not reach is left out. */
  findBoardsByIds(input: BoardReach & { dashboardIds: readonly string[] }): Promise<BoardRecord[]>;
  /** No description, the default origins; `createdById` null and scope Project when absent. */
  createBoard(input: {
    id: string;
    projectId: string;
    name: string;
    createdById?: string | null;
    scope?: DashboardScope;
  }): Promise<BoardRecord>;
  updateBoard(input: {
    projectId: string;
    dashboardId: string;
    data: BoardUpdate;
  }): Promise<BoardRecord>;
  /**
   * In one transaction: the board, its widgets, every star on it, and its stale legacy copy
   * (srcdoc rows on it, and the Dashboard row when it holds no Reports chart). Reports charts,
   * their triggers and every other row stay. dashboards-v2.feature AC199b.
   */
  deleteBoard(input: { projectId: string; dashboardId: string }): Promise<BoardRecord>;

  /** The member's stars in their own order; a star on a gone board is skipped. */
  findStarred(input: MemberStars): Promise<StarredDashboard[]>;
  /** The board ids the member has starred, for marking a list. */
  findStarredDashboardIds(input: MemberStars): Promise<string[]>;
  /**
   * Appends a star at the end of the member's order; a no-op when already starred. `projectId`
   * is where the row is stored; `listedInProjectId` is where it was starred, when that differs.
   */
  addStar(input: {
    projectId: string;
    userId: string;
    star: DashboardStar;
    listedInProjectId?: string;
  }): Promise<void>;
  removeStar(input: { projectId: string; userId: string; star: DashboardStar }): Promise<void>;
  /** Sets each given star's position from the order given; other stars are untouched. */
  reorderStars(input: MemberStars & { stars: DashboardStar[] }): Promise<void>;
  /** How many members other than this one starred the board. */
  countOtherStars(input: {
    projectId: string;
    dashboardId: string;
    userId: string;
  }): Promise<number>;
}
