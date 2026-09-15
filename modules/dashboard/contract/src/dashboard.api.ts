import type {
  LangWatchQLBudgetOverflowMode,
  LangWatchQLProtections,
  LangWatchQLQueryResult,
  LangWatchQLTimeWindow,
} from "@langwatch/analytics-contract";
import type { Trigger } from "@langwatch/automation-contract";
import { moduleApi } from "@langwatch/runtime-composition";

import type { Dashboard, DashboardSummary } from "./dashboard.ts";
import type { Graph, GraphLayout } from "./graph.ts";
import type { SavedView, SavedViewPeriod } from "./saved-view.ts";
import type { SavedWorkbenchChart } from "./saved-workbench-chart.ts";

/** The graph kinds a dashboard list promises its consumer it counted. */
export type DashboardGraphCountScope = "builder" | "placeable";

/** A caller-authorized replacement for a saved chart's executable definition. */
export type SavedWorkbenchChartDefinitionUpdate = Readonly<{
  definition: unknown;
  protections: LangWatchQLProtections;
}>;

/** Flat operations a door or a peer calls once the dashboard app is composed. */
export interface DashboardApi {
  getAll(input: {
    projectId: string;
    graphCountScope: DashboardGraphCountScope;
  }): Promise<DashboardSummary[]>;
  getById(input: {
    projectId: string;
    dashboardId: string;
  }): Promise<Dashboard & { graphs: Graph[] }>;
  create(input: { projectId: string; name: string }): Promise<Dashboard>;
  rename(input: { projectId: string; dashboardId: string; name: string }): Promise<Dashboard>;
  delete(input: { projectId: string; dashboardId: string }): Promise<Dashboard>;
  reorder(input: { projectId: string; dashboardIds: string[] }): Promise<{ success: true }>;
  getOrCreateFirst(input: { projectId: string }): Promise<Dashboard>;
  /** Where a reader opens each of these dashboards, keyed by dashboard id. */
  getDashboardLinks(input: {
    projectId: string;
    dashboardIds: string[];
  }): Promise<Record<string, string>>;

  listGraphs(input: { projectId: string; dashboardId?: string }): Promise<Graph[]>;
  getGraph(input: { projectId: string; graphId: string }): Promise<Graph>;
  createGraph(input: {
    projectId: string;
    name: string;
    graph: Record<string, unknown>;
    filters?: Record<string, unknown>;
    dashboardId?: string;
    layout?: Partial<GraphLayout>;
  }): Promise<Graph>;
  updateGraph(input: {
    projectId: string;
    graphId: string;
    name?: string;
    graph?: Record<string, unknown>;
    filters?: Record<string, unknown>;
  }): Promise<Graph>;
  deleteGraph(input: { projectId: string; graphId: string }): Promise<Graph>;
  updateGraphLayout(input: {
    projectId: string;
    graphId: string;
    layout: GraphLayout;
  }): Promise<Graph>;
  batchUpdateGraphLayouts(input: {
    projectId: string;
    layouts: Array<{ graphId: string; layout: GraphLayout }>;
  }): Promise<{ success: true }>;

  /** The alert automations watching a set of charts, with their secrets stripped. */
  getAlertsForGraphs(input: { projectId: string; customGraphIds: string[] }): Promise<Trigger[]>;
  /** The live alert watching one chart, when one does; secrets stripped. */
  findAlertForGraph(input: {
    projectId: string;
    customGraphId: string;
  }): Promise<Trigger | undefined>;

  listSavedWorkbenchCharts(input: { projectId: string }): Promise<SavedWorkbenchChart[]>;
  getSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
  }): Promise<SavedWorkbenchChart>;
  /** For a credential that resolved its own protections, such as an API key. */
  createSavedWorkbenchChart(input: {
    projectId: string;
    protections: LangWatchQLProtections;
    name: string;
    definition: unknown;
    id?: string;
  }): Promise<SavedWorkbenchChart>;
  updateSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    name?: string;
    definitionUpdate?: SavedWorkbenchChartDefinitionUpdate;
  }): Promise<SavedWorkbenchChart>;
  /** For a signed-in member, whose own protections decide what the chart may name. */
  createMemberSavedWorkbenchChart(input: {
    projectId: string;
    actorId: string;
    name: string;
    definition: unknown;
  }): Promise<SavedWorkbenchChart>;
  updateMemberSavedWorkbenchChart(input: {
    projectId: string;
    actorId: string;
    chartId: string;
    name?: string;
    definition?: unknown;
  }): Promise<SavedWorkbenchChart>;
  deleteSavedWorkbenchChart(input: { projectId: string; chartId: string }): Promise<void>;
  placeSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    dashboardId: string;
    gridColumn?: number;
    gridRow?: number;
    colSpan?: number;
    rowSpan?: number;
  }): Promise<SavedWorkbenchChart>;
  unplaceSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
  }): Promise<SavedWorkbenchChart>;
  runSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    actorId: string;
    timeWindow?: LangWatchQLTimeWindow;
    granularitySeconds?: number;
    onBudgetOverflow?: LangWatchQLBudgetOverflowMode;
  }): Promise<LangWatchQLQueryResult>;

  listSavedViews(input: {
    projectId: string;
    actorId: string;
    kind?: string;
  }): Promise<SavedView[]>;
  createSavedView(input: {
    projectId: string;
    actorId: string;
    id?: string;
    name: string;
    filters: Record<string, unknown>;
    query?: string;
    period?: SavedViewPeriod;
    /** Present for a personal view, absent for one shared with the project. */
    personal: boolean;
    kind?: string;
  }): Promise<SavedView>;
  deleteSavedView(input: {
    projectId: string;
    actorId: string;
    viewId: string;
  }): Promise<SavedView>;
  renameSavedView(input: {
    projectId: string;
    actorId: string;
    viewId: string;
    name: string;
  }): Promise<SavedView>;
  reorderSavedViews(input: {
    projectId: string;
    actorId: string;
    viewIds: string[];
  }): Promise<{ success: true }>;
}

export const DashboardApi = moduleApi<DashboardApi>("dashboard");
