import type {
  Dashboard,
  DashboardSummary,
  DashboardViewer,
  Graph,
  GraphLayout,
  SavedWorkbenchChart,
  SavedWorkbenchChartDefinition,
  DashboardUsageCount,
} from "@langwatch/dashboard-contract";

/** Which chart kinds a row belongs to: the builder's, or a saved LangWatchQL one. */
export type DashboardGraphKind = "builder" | "workbench_sql";

export type DashboardRecord = Dashboard;

/** The editable field of a Reports board; its retiring scope columns take no new write. */
export type DashboardUpdate = Readonly<{ name?: string }>;
export type DashboardSummaryRecord = DashboardSummary;

/**
 * Who reads, from which project. Another member's Only me row, and a chart on one, is not there;
 * nor is any Only me row for a project credential or once its author is erased (AC199m).
 */
export type DashboardReach = Readonly<{ projectId: string; viewer?: DashboardViewer }>;
export type GraphRecord = Graph;

/** The stored chart before its definition is parsed against the contract. */
export type SavedWorkbenchChartRecord = Omit<SavedWorkbenchChart, "definition"> & {
  definition: unknown;
};

/**
 * The Analytics Reports boards, builder graphs and saved workbench charts (Dashboard, CustomGraph).
 * Reads leave out a board only Dashboards holds and what the reach does not see; a srcdoc row is a
 * stale copy, never a chart. A write naming a row the project lacks is refused.
 */
export interface DashboardRepository {
  /** The project's boards in `order`. */
  findAllDashboards(
    input: DashboardReach & { graphKinds: readonly DashboardGraphKind[] },
  ): Promise<DashboardSummaryRecord[]>;
  findDashboard(
    input: DashboardReach & { dashboardId: string },
  ): Promise<(DashboardRecord & { graphs: GraphRecord[] }) | undefined>;
  /** The rows among these ids the read reaches; an id it does not reach is left out. */
  findDashboards(input: DashboardReach & { dashboardIds: string[] }): Promise<DashboardRecord[]>;
  findLastDashboard(input: { projectId: string }): Promise<DashboardRecord | undefined>;
  /** At the scope Project with no author: the scope columns are retiring. */
  createDashboard(input: {
    id: string;
    projectId: string;
    name: string;
    order: number;
  }): Promise<DashboardRecord>;
  updateDashboard(input: {
    projectId: string;
    dashboardId: string;
    data: DashboardUpdate;
  }): Promise<DashboardRecord>;
  /**
   * The ids among these that only the Dashboards area holds: in DashboardsV2 with no Reports
   * chart. A Reports write refuses them as absent (AC199j).
   */
  findDashboardsOnlyIds(input: {
    projectId: string;
    dashboardIds: readonly string[];
  }): Promise<string[]>;
  /** The board and its charts; DashboardsV2, its widgets and stars are untouched (AC199d). */
  deleteDashboard(input: { projectId: string; dashboardId: string }): Promise<DashboardRecord>;
  updateDashboardOrder(input: { projectId: string; dashboardIds: string[] }): Promise<void>;

  findAllGraphs(input: DashboardReach & { dashboardId?: string }): Promise<GraphRecord[]>;
  findGraph(input: DashboardReach & { graphId: string }): Promise<GraphRecord | undefined>;
  /**
   * The first grid row below every Reports card on the dashboard, builder or workbench, so a
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

  findAllSavedWorkbenchCharts(input: DashboardReach): Promise<SavedWorkbenchChartRecord[]>;
  findSavedWorkbenchChart(
    input: DashboardReach & { chartId: string },
  ): Promise<SavedWorkbenchChartRecord | undefined>;
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
  /**
   * The usage report's count: `charts` is Reports charts plus Dashboards widgets, stale srcdoc
   * copies left out. The caller never passes an empty project list.
   */
  countUsage(input: { projectIds: readonly string[] }): Promise<DashboardUsageCount>;
}
