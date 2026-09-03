import type { Dashboard, DashboardSummary } from "./dashboard";
import type {
  LangWatchQLProtections,
  LangWatchQLQueryResult,
  LangWatchQLRunContext,
} from "@langwatch/analytics-contract";
import type { Graph, GraphLayout } from "./graph";
import type { SavedWorkbenchChart } from "./saved-workbench-chart";

export abstract class DashboardService {
  abstract getAll(input: {
    projectId: string;
    graphCountScope: DashboardGraphCountScope;
  }): Promise<DashboardSummary[]>;
  abstract getById(input: {
    projectId: string;
    dashboardId: string;
  }): Promise<Dashboard & { graphs: Graph[] }>;
  abstract create(input: { projectId: string; name: string }): Promise<Dashboard>;
  abstract rename(input: {
    projectId: string;
    dashboardId: string;
    name: string;
  }): Promise<Dashboard>;
  abstract delete(input: { projectId: string; dashboardId: string }): Promise<Dashboard>;
  abstract reorder(input: {
    projectId: string;
    dashboardIds: string[];
  }): Promise<{ success: true }>;
  abstract getOrCreateFirst(input: { projectId: string }): Promise<Dashboard>;

  abstract listGraphs(input: { projectId: string; dashboardId?: string }): Promise<Graph[]>;
  abstract getGraph(input: { projectId: string; graphId: string }): Promise<Graph>;
  abstract createGraph(input: {
    projectId: string;
    name: string;
    graph: Record<string, unknown>;
    filters?: Record<string, unknown>;
    dashboardId?: string;
    layout?: Partial<GraphLayout>;
  }): Promise<Graph>;
  abstract updateGraph(input: {
    projectId: string;
    graphId: string;
    name?: string;
    graph?: Record<string, unknown>;
    filters?: Record<string, unknown>;
  }): Promise<Graph>;
  abstract deleteGraph(input: { projectId: string; graphId: string }): Promise<Graph>;
  abstract updateGraphLayout(input: {
    projectId: string;
    graphId: string;
    layout: GraphLayout;
  }): Promise<Graph>;
  abstract batchUpdateGraphLayouts(input: {
    projectId: string;
    layouts: Array<{ graphId: string; layout: GraphLayout }>;
  }): Promise<{ success: true }>;

  abstract listSavedWorkbenchCharts(input: { projectId: string }): Promise<SavedWorkbenchChart[]>;
  abstract getSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
  }): Promise<SavedWorkbenchChart>;
  abstract createSavedWorkbenchChart(input: {
    projectId: string;
    protections: LangWatchQLProtections;
    name: string;
    definition: unknown;
    id?: string;
  }): Promise<SavedWorkbenchChart>;
  abstract updateSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    name?: string;
    definitionUpdate?: SavedWorkbenchChartDefinitionUpdate;
  }): Promise<SavedWorkbenchChart>;
  abstract deleteSavedWorkbenchChart(input: { projectId: string; chartId: string }): Promise<void>;
  abstract placeSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    dashboardId: string;
    gridColumn?: number;
    gridRow?: number;
    colSpan?: number;
    rowSpan?: number;
  }): Promise<SavedWorkbenchChart>;
  abstract unplaceSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
  }): Promise<SavedWorkbenchChart>;
  abstract runSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    execution: LangWatchQLRunContext;
  }): Promise<LangWatchQLQueryResult>;
}

/** The graph kinds a dashboard list promises its consumer it counted. */
export type DashboardGraphCountScope = "builder" | "placeable";

/** A caller-authorized replacement for a saved chart's executable definition. */
export type SavedWorkbenchChartDefinitionUpdate = Readonly<{
  definition: unknown;
  protections: LangWatchQLProtections;
}>;
