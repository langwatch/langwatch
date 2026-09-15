import type {
  Dashboard,
  DashboardSummary,
  Graph,
  GraphLayout,
  SavedWorkbenchChart,
  SavedWorkbenchChartDefinition,
} from "@langwatch/dashboard-contract";

/** Which chart kinds a row belongs to: the builder's, or a saved LangWatchQL one. */
export type DashboardGraphKind = "builder" | "workbench_sql";

export type DashboardRecord = Dashboard;
export type DashboardSummaryRecord = DashboardSummary;
export type GraphRecord = Graph;

/** The stored chart before its definition is parsed against the contract. */
export type SavedWorkbenchChartRecord = Omit<SavedWorkbenchChart, "definition"> & {
  definition: unknown;
};

/**
 * The dashboards, their builder graphs and their saved workbench charts: three
 * shapes over the two tables Dashboard owns.
 *
 * A write that names a row the project does not have raises the feature's own
 * absence rather than answering with nothing, so every backend refuses it the
 * same way.
 */
export interface DashboardRepository {
  findAllDashboards(input: {
    projectId: string;
    graphKinds: readonly DashboardGraphKind[];
  }): Promise<DashboardSummaryRecord[]>;
  findDashboard(input: {
    projectId: string;
    dashboardId: string;
  }): Promise<(DashboardRecord & { graphs: GraphRecord[] }) | undefined>;
  findFirstDashboard(input: { projectId: string }): Promise<DashboardRecord | undefined>;
  findLastDashboard(input: { projectId: string }): Promise<DashboardRecord | undefined>;
  findDashboardIds(input: { projectId: string; dashboardIds: string[] }): Promise<string[]>;
  createDashboard(input: {
    id: string;
    projectId: string;
    name: string;
    order: number;
  }): Promise<DashboardRecord>;
  updateDashboard(input: {
    projectId: string;
    dashboardId: string;
    data: { name: string };
  }): Promise<DashboardRecord>;
  deleteDashboard(input: { projectId: string; dashboardId: string }): Promise<DashboardRecord>;
  updateDashboardOrder(input: { projectId: string; dashboardIds: string[] }): Promise<void>;

  findAllGraphs(input: { projectId: string; dashboardId?: string }): Promise<GraphRecord[]>;
  findGraph(input: { projectId: string; graphId: string }): Promise<GraphRecord | undefined>;
  findLastGraphGridRow(input: {
    projectId: string;
    dashboardId: string;
  }): Promise<number | undefined>;
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
    layouts: Array<{ graphId: string; layout: GraphLayout }>;
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
}
