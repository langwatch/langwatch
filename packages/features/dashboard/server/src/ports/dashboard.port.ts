import type {
  Graph,
  GraphLayout,
  SavedWorkbenchChartDefinition,
} from "@langwatch/dashboard-contract";

export type DashboardRecord = {
  id: string;
  projectId: string;
  name: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
};

export type DashboardSummaryRecord = DashboardRecord & { graphCount: number };
export type GraphRecord = Graph;

export type SavedWorkbenchChartRecord = {
  id: string;
  projectId: string;
  name: string;
  definition: unknown;
  createdAt: Date;
  updatedAt: Date;
};

/** The one private persistence capability owned by Dashboard. */
export abstract class DashboardRepository {
  abstract findAllDashboards(input: { projectId: string }): Promise<DashboardSummaryRecord[]>;
  abstract tryFindDashboard(input: { projectId: string; dashboardId: string }): Promise<(DashboardRecord & { graphs: GraphRecord[] }) | null>;
  abstract tryFindFirstDashboard(input: { projectId: string }): Promise<DashboardRecord | null>;
  abstract tryFindLastDashboard(input: { projectId: string }): Promise<DashboardRecord | null>;
  abstract findDashboardIds(input: { projectId: string; dashboardIds: string[] }): Promise<string[]>;
  abstract createDashboard(input: { id: string; projectId: string; name: string; order: number }): Promise<DashboardRecord>;
  abstract updateDashboard(input: { projectId: string; dashboardId: string; data: { name: string } }): Promise<DashboardRecord>;
  abstract deleteDashboard(input: { projectId: string; dashboardId: string }): Promise<DashboardRecord>;
  abstract updateDashboardOrder(input: { projectId: string; dashboardIds: string[] }): Promise<void>;

  abstract findAllGraphs(input: { projectId: string; dashboardId?: string }): Promise<GraphRecord[]>;
  abstract tryFindGraph(input: { projectId: string; graphId: string }): Promise<GraphRecord | null>;
  abstract tryFindLastGraphGridRow(input: { projectId: string; dashboardId: string }): Promise<number | null>;
  abstract createGraph(input: { id: string; projectId: string; name: string; graph: Record<string, unknown>; filters: Record<string, unknown>; dashboardId: string | null; layout: GraphLayout }): Promise<GraphRecord>;
  abstract updateGraph(input: { projectId: string; graphId: string; name?: string; graph?: Record<string, unknown>; filters?: Record<string, unknown> }): Promise<GraphRecord>;
  abstract deleteGraph(input: { projectId: string; graphId: string }): Promise<GraphRecord>;
  abstract updateGraphLayout(input: { projectId: string; graphId: string; layout: GraphLayout }): Promise<GraphRecord>;
  abstract updateGraphLayouts(input: { projectId: string; layouts: Array<{ graphId: string; layout: GraphLayout }> }): Promise<void>;

  abstract findAllSavedWorkbenchCharts(input: { projectId: string }): Promise<SavedWorkbenchChartRecord[]>;
  abstract tryFindSavedWorkbenchChart(input: { projectId: string; chartId: string }): Promise<SavedWorkbenchChartRecord | null>;
  abstract createSavedWorkbenchChart(input: { id: string; projectId: string; name: string; definition: SavedWorkbenchChartDefinition }): Promise<SavedWorkbenchChartRecord>;
  abstract tryUpdateSavedWorkbenchChart(input: { projectId: string; chartId: string; name?: string; definition?: SavedWorkbenchChartDefinition }): Promise<SavedWorkbenchChartRecord | null>;
  abstract deleteSavedWorkbenchChart(input: { projectId: string; chartId: string }): Promise<number>;
}

/** Application-owned validation for LWQL and Vega-Lite definitions. */
export abstract class SavedWorkbenchChartPolicy {
  abstract validate(input: { projectId: string; definition: SavedWorkbenchChartDefinition }): void | Promise<void>;
}

export abstract class DashboardIdGenerator {
  abstract generate(): string;
}
