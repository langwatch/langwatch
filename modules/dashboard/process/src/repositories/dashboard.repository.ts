import type {
  Dashboard,
  DashboardScope,
  DashboardStar,
  DashboardSummary,
  StarredDashboard,
  Graph,
  GraphLayout,
  SavedWorkbenchChart,
  SavedWorkbenchChartDefinition,
  DashboardUsageCount,
} from "@langwatch/dashboard-contract";

/** Which chart kinds a row belongs to: the builder's, or a saved LangWatchQL one. */
export type DashboardGraphKind = "builder" | "workbench_sql";

export type DashboardRecord = Dashboard;

/** The editable fields of a stored board; an absent key is left as it is. */
export type DashboardUpdate = Readonly<{
  name?: string;
  description?: string | null;
  createdById?: string;
  scope?: DashboardScope;
  organizationId?: string;
}>;
/** The stored summary: stars and the owner's name are per reader, so the service adds them. */
export type DashboardSummaryRecord = Omit<DashboardSummary, "isStarred" | "ownerProject">;

/**
 * The project a read is made from. With `organizationId` the read also reaches the
 * Organization boards other projects of that organization own; the service decides who sees what.
 */
export type DashboardReach = Readonly<{ projectId: string; organizationId?: string }>;
export type GraphRecord = Graph;

/** The stored chart before its definition is parsed against the contract. */
export type SavedWorkbenchChartRecord = Omit<SavedWorkbenchChart, "definition"> & {
  definition: unknown;
};

/** One member's stars as one project lists them. */
export type MemberStars = Readonly<{
  projectId: string;
  userId: string;
  sharedProjectIds?: readonly string[];
}>;

/**
 * The dashboards, their builder graphs and their saved workbench charts:
 * three shapes over the two tables Dashboard owns. A write naming a row the
 * project lacks raises the feature's own absence — every backend refuses alike.
 */
export interface DashboardRepository {
  /** The project's boards in `order`, then the organization's from other projects. */
  findAllDashboards(
    input: DashboardReach & { graphKinds: readonly DashboardGraphKind[] },
  ): Promise<DashboardSummaryRecord[]>;
  findDashboard(
    input: DashboardReach & { dashboardId: string },
  ): Promise<(DashboardRecord & { graphs: GraphRecord[] }) | undefined>;
  /** The rows among these ids the read reaches; an id it does not reach is left out. */
  findDashboards(input: DashboardReach & { dashboardIds: string[] }): Promise<DashboardRecord[]>;
  findLastDashboard(input: { projectId: string }): Promise<DashboardRecord | undefined>;
  /** No description; `createdById` null and scope Project when absent. */
  createDashboard(input: {
    id: string;
    projectId: string;
    name: string;
    order: number;
    createdById?: string | null;
    scope?: DashboardScope;
  }): Promise<DashboardRecord>;
  updateDashboard(input: {
    projectId: string;
    dashboardId: string;
    data: DashboardUpdate;
  }): Promise<DashboardRecord>;
  /** Removes the board, its graphs, and the row from every member's favourites. */
  deleteDashboard(input: { projectId: string; dashboardId: string }): Promise<DashboardRecord>;
  updateDashboardOrder(input: { projectId: string; dashboardIds: string[] }): Promise<void>;

  /**
   * The member's stars in their own order; a star on a gone board is skipped. A board's star is
   * stored under the project that owns the board, so `sharedProjectIds` names the other projects
   * whose boards this project lists. Template stars are this project's alone.
   */
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

  findAllGraphs(input: { projectId: string; dashboardId?: string }): Promise<GraphRecord[]>;
  findGraph(input: { projectId: string; graphId: string }): Promise<GraphRecord | undefined>;
  /**
   * The first grid row below every card on the dashboard, whichever kind, so a
   * new card never lands on a tall one; row 0 on an empty dashboard.
   */
  findNextFreeGridRow(input: { projectId: string; dashboardId: string }): Promise<number>;
  createGraph(input: {
    id: string;
    projectId: string;
    name: string;
    graph: Record<string, unknown>;
    filters: Record<string, unknown>;
    dashboardId: string | null;
    layout: GraphLayout;
  }): Promise<GraphRecord>;
  updateGraph(input: {
    projectId: string;
    graphId: string;
    name?: string;
    graph?: Record<string, unknown>;
    filters?: Record<string, unknown>;
  }): Promise<GraphRecord>;
  deleteGraph(input: { projectId: string; graphId: string }): Promise<GraphRecord>;
  updateGraphLayout(input: {
    projectId: string;
    graphId: string;
    layout: GraphLayout;
  }): Promise<GraphRecord>;
  updateGraphLayouts(input: {
    projectId: string;
    layouts: { graphId: string; layout: GraphLayout }[];
  }): Promise<void>;

  findAllSavedWorkbenchCharts(input: { projectId: string }): Promise<SavedWorkbenchChartRecord[]>;
  findSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
  }): Promise<SavedWorkbenchChartRecord | undefined>;
  createSavedWorkbenchChart(input: {
    id: string;
    projectId: string;
    name: string;
    definition: SavedWorkbenchChartDefinition;
  }): Promise<SavedWorkbenchChartRecord>;
  /** Raises the chart's own absence when the project holds no such chart. */
  updateSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    name?: string;
    definition?: SavedWorkbenchChartDefinition;
  }): Promise<SavedWorkbenchChartRecord>;
  deleteSavedWorkbenchChart(input: { projectId: string; chartId: string }): Promise<void>;
  placeSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    dashboardId: string;
    gridColumn: number;
    gridRow: number;
    colSpan: number;
    rowSpan: number;
  }): Promise<SavedWorkbenchChartRecord>;
  unplaceSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
  }): Promise<SavedWorkbenchChartRecord>;
  /** The usage report's count; the caller never passes an empty project list. */
  countUsage(input: { projectIds: readonly string[] }): Promise<DashboardUsageCount>;
}
