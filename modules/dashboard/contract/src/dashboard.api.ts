import type {
  DashboardWidget,
  DashboardWidgetDefinitionInput,
  LangWatchQLBudgetOverflowMode,
  LangWatchQLProtections,
  LangWatchQLQueryResult,
  LangWatchQLTimeWindow,
} from "@langwatch/analytics-contract";
import type { Trigger } from "@langwatch/automation-contract";
import { moduleApi } from "@langwatch/kernel/module-api";

import type {
  Dashboard,
  DashboardSourcePresence,
  DashboardSummary,
  DashboardViewer,
  DashboardVisibility,
} from "./dashboard.ts";
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

/**
 * What the install-wide usage report counts here (ADR-156, section 10): the
 * charts built in the chart builder, lifetime. Saved workbench charts share
 * the table but are another product and are not counted.
 */
export interface DashboardUsageCount {
  readonly builderCharts: number;
}

/** Flat operations a door or a peer calls once the dashboard app is composed. */
export interface DashboardApi {
  /**
   * `viewer` is the signed-in member: boards outside their audience read as not
   * found; without one only organisation-wide boards are reachable. Writes to a
   * code-defined board refuse with `dashboard_read_only`.
   */
  getAll(input: {
    projectId: string;
    graphCountScope: DashboardGraphCountScope;
    viewer?: DashboardViewer;
  }): Promise<DashboardSummary[]>;
  getById(input: {
    projectId: string;
    dashboardId: string;
    viewer?: DashboardViewer;
  }): Promise<Dashboard & { graphs: Graph[] }>;
  /** `createdById` is the member creating it; absent for a project credential. */
  create(input: { projectId: string; name: string; createdById?: string }): Promise<Dashboard>;
  rename(input: {
    projectId: string;
    dashboardId: string;
    name: string;
    viewer?: DashboardViewer;
  }): Promise<Dashboard>;
  /** Only the creator or an admin (`dashboard_owner_only`), unless the board predates creators. */
  delete(input: {
    projectId: string;
    dashboardId: string;
    viewer?: DashboardViewer;
  }): Promise<Dashboard>;
  reorder(input: {
    projectId: string;
    dashboardIds: string[];
    viewer?: DashboardViewer;
  }): Promise<{ success: true }>;
  getOrCreateFirst(input: { projectId: string; viewer?: DashboardViewer }): Promise<Dashboard>;
  /** Where a reader opens each of these dashboards, keyed by dashboard id. */
  getDashboardLinks(input: {
    projectId: string;
    dashboardIds: string[];
  }): Promise<Record<string, string>>;

  /** Dashboards area: `dashboards_not_enabled` while `release_dashboards` is off. */
  updateDashboardDetails(input: {
    projectId: string;
    dashboardId: string;
    viewer: DashboardViewer;
    name?: string;
    description?: string | null;
  }): Promise<Dashboard>;
  /** Dashboards area. Same creator-or-admin rule as `delete`. */
  setDashboardVisibility(input: {
    projectId: string;
    dashboardId: string;
    viewer: DashboardViewer;
    visibility: DashboardVisibility;
  }): Promise<Dashboard>;
  /** Dashboards area: whether each Flight Deck source ever recorded a row, as this member reads. */
  getSourcePresence(input: {
    projectId: string;
    viewer: DashboardViewer;
  }): Promise<DashboardSourcePresence>;

  /** Graphs on a board outside the viewer's audience read and write as not found. */
  listGraphs(input: {
    projectId: string;
    dashboardId?: string;
    viewer?: DashboardViewer;
  }): Promise<Graph[]>;
  getGraph(input: { projectId: string; graphId: string; viewer?: DashboardViewer }): Promise<Graph>;
  createGraph(input: {
    projectId: string;
    name: string;
    graph: Record<string, unknown>;
    filters?: Record<string, unknown>;
    dashboardId?: string;
    layout?: Partial<GraphLayout>;
    viewer?: DashboardViewer;
  }): Promise<Graph>;
  updateGraph(input: {
    projectId: string;
    graphId: string;
    name?: string;
    graph?: Record<string, unknown>;
    filters?: Record<string, unknown>;
    viewer?: DashboardViewer;
  }): Promise<Graph>;
  deleteGraph(input: {
    projectId: string;
    graphId: string;
    viewer?: DashboardViewer;
  }): Promise<Graph>;
  updateGraphLayout(input: {
    projectId: string;
    graphId: string;
    layout: GraphLayout;
    viewer?: DashboardViewer;
  }): Promise<Graph>;
  batchUpdateGraphLayouts(input: {
    projectId: string;
    layouts: { graphId: string; layout: GraphLayout }[];
    viewer?: DashboardViewer;
  }): Promise<{ success: true }>;

  /**
   * Custom chart widgets: a third kind of card on the same grid, whose
   * definition analytics owns and whose placement this feature stores.
   */
  assertCustomChartPlaygroundEnabled(input: { projectId: string }): Promise<void>;
  /** Widgets follow their board's audience, as `getAll` does; unplaced ones reach everyone. */
  listDashboardWidgets(input: {
    projectId: string;
    viewer?: DashboardViewer;
  }): Promise<DashboardWidget[]>;
  getDashboardWidget(input: {
    projectId: string;
    id: string;
    viewer?: DashboardViewer;
  }): Promise<DashboardWidget>;
  /** Placed on `dashboardId` when named, otherwise on the unplaced authoring grid. */
  createDashboardWidget(
    input: {
      projectId: string;
      dashboardId?: string;
      name: string;
      viewer?: DashboardViewer;
    } & DashboardWidgetDefinitionInput,
  ): Promise<DashboardWidget>;
  updateDashboardWidget(
    input: {
      projectId: string;
      id: string;
      name?: string;
      viewer?: DashboardViewer;
    } & Partial<DashboardWidgetDefinitionInput>,
  ): Promise<DashboardWidget>;
  assignDashboardWidgetToDashboard(input: {
    projectId: string;
    id: string;
    dashboardId: string;
    viewer?: DashboardViewer;
  }): Promise<DashboardWidget>;
  deleteDashboardWidget(input: {
    projectId: string;
    id: string;
    viewer?: DashboardViewer;
  }): Promise<void>;
  /** Moves or resizes one widget; an id naming no widget here changes nothing. */
  updateDashboardWidgetLayout(input: {
    projectId: string;
    graphId: string;
    layout: GraphLayout;
    viewer?: DashboardViewer;
  }): Promise<{ success: true }>;
  /** Moves or resizes several widgets together; ids naming no widget here change nothing. */
  batchUpdateDashboardWidgetLayouts(input: {
    projectId: string;
    layouts: { graphId: string; layout: GraphLayout }[];
    viewer?: DashboardViewer;
  }): Promise<{ success: true }>;
  /** The deep link back to the dashboards list for a playground widget. */
  dashboardWidgetPlatformUrl(input: { projectSlug: string }): string;

  /** The alert automations watching a set of charts, with their secrets stripped. */
  getAlertsForGraphs(input: { projectId: string; customGraphIds: string[] }): Promise<Trigger[]>;
  /** The live alert watching one chart, when one does; secrets stripped. */
  findAlertForGraph(input: {
    projectId: string;
    customGraphId: string;
  }): Promise<Trigger | undefined>;

  /** The experimental gate over the whole workbench surface, asked per request. */
  isWorkbenchEnabled(input: { projectId: string }): Promise<boolean>;
  /** Charts placed on a board outside the viewer's audience are left out or read as not found. */
  listSavedWorkbenchCharts(input: {
    projectId: string;
    viewer?: DashboardViewer;
  }): Promise<SavedWorkbenchChart[]>;
  getSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    viewer?: DashboardViewer;
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
    viewer?: DashboardViewer;
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
    viewer?: DashboardViewer;
  }): Promise<SavedWorkbenchChart>;
  deleteSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    viewer?: DashboardViewer;
  }): Promise<void>;
  placeSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    dashboardId: string;
    gridColumn?: number;
    gridRow?: number;
    colSpan?: number;
    rowSpan?: number;
    viewer?: DashboardViewer;
  }): Promise<SavedWorkbenchChart>;
  unplaceSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    viewer?: DashboardViewer;
  }): Promise<SavedWorkbenchChart>;
  runSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    actorId: string;
    timeWindow?: LangWatchQLTimeWindow;
    granularitySeconds?: number;
    onBudgetOverflow?: LangWatchQLBudgetOverflowMode;
    viewer?: DashboardViewer;
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
  /** The usage report's figures (ADR-156, section 10). */
  countUsage(input: { projectIds: readonly string[] }): Promise<DashboardUsageCount>;
}

export const DashboardApi = moduleApi<DashboardApi>()("dashboard");
