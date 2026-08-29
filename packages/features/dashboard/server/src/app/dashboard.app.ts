/**
 * The dashboard feature's application: what its doors call.
 *
 * It holds the services and ports the feature's api files reach, and it is the
 * one typed thing a transport is given. Before it, each door declared its own
 * private bag — `Readonly<{ dashboard: DashboardService }>` three times over,
 * `Readonly<{ dashboard; automation }>` once, and a bare
 * `() => DashboardService` in each of the two REST families — six descriptions
 * of the same composition, agreeing by attention rather than by construction.
 *
 * Most operations are the service's own. What lives here as a decision is what
 * every door was making for itself, and making differently:
 *
 *   - **what a missing dashboard or graph IS.** The contract raises plain
 *     `Error` subclasses, so each door had to recognise them: the tRPC
 *     surfaces on the imported class, the REST families on
 *     `error.name === "GraphNotFoundError"` — a string comparison inside a
 *     transport, which no compiler checks and a rename would have turned into
 *     a silent 500. Every one of those refusals is named here, once, as a
 *     `HandledError` with a stable code; a door is left to decide only how it
 *     words the answer.
 *   - **the alert watching a graph.** The chart card reads it; nothing else in
 *     Dashboard depends on Automation, so it arrives as the two methods it
 *     calls rather than the whole automation service.
 *
 * What deliberately did NOT move here: the saved-view lifecycle, and the graph
 * door's filter-field catalogue and secret redaction. Each is generic in a type
 * the process owns — the saved view's own row shape, the deployment's filter
 * field union — and folding them into a non-generic application would narrow
 * what the client sees. They stay mount ports until the verticals that own
 * them are drained.
 */
import type {
  LangWatchQLProtections,
  LangWatchQLQueryResult,
  LangWatchQLRunContext,
} from "@langwatch/analytics-contract";
import type { Trigger } from "@langwatch/automation-contract";
import {
  DashboardNotFoundError,
  DashboardReorderError,
  GraphNotFoundError,
  type Dashboard,
  type DashboardGraphCountScope,
  type DashboardService,
  type DashboardSummary,
  type Graph,
  type GraphLayout,
  type SavedWorkbenchChart,
  type SavedWorkbenchChartDefinitionUpdate,
} from "@langwatch/dashboard-contract";
import { HandledError } from "@langwatch/handled-error";

// ---------------------------------------------------------------------------
// The refusals this feature names.
//
// Each replaces a branch a transport used to own: two `TRPCError`s built by
// hand, and two `error.name === "…"` string comparisons. The status each
// carries is the status those branches already answered with.
// ---------------------------------------------------------------------------

/** A dashboard the project does not have. */
export class DashboardNotThereError extends HandledError {
  declare readonly code: "dashboard_not_found";

  constructor(projectId: string) {
    super("dashboard_not_found", "Dashboard not found", {
      httpStatus: 404,
      meta: { projectId },
    });
    this.name = "DashboardNotThereError";
  }
}

/** A graph the project does not have. */
export class GraphNotThereError extends HandledError {
  declare readonly code: "graph_not_found";

  constructor(projectId: string) {
    super("graph_not_found", "Graph not found", { httpStatus: 404, meta: { projectId } });
    this.name = "GraphNotThereError";
  }
}

/**
 * A reorder naming dashboards the project does not have.
 *
 * 404 rather than 400 because that is what the tRPC surface has always
 * answered, and it is the reading that matches the cause: the request is
 * well-formed and the ids in it are not there. The REST family answers 400 for
 * the same refusal and keeps doing so — that disagreement predates this
 * application, and reconciling it would change a published status.
 */
export class DashboardReorderUnknownIdsError extends HandledError {
  declare readonly code: "dashboard_reorder_unknown_ids";

  constructor(missingIds: readonly string[]) {
    super("dashboard_reorder_unknown_ids", `Dashboards not found: ${missingIds.join(", ")}`, {
      httpStatus: 404,
      meta: { ids: [...missingIds] },
    });
    this.name = "DashboardReorderUnknownIdsError";
  }
}

/** The alert reads Dashboard makes on the Automation feature. */
export type DashboardGraphAlertLookup = Readonly<{
  getByCustomGraphIds(
    input: Readonly<{ projectId: string; customGraphIds: string[] }>,
  ): Promise<Trigger[]>;
  tryGetByCustomGraphId(
    input: Readonly<{ projectId: string; customGraphId: string }>,
  ): Promise<Trigger | null>;
}>;

/** What the process composes this feature's application from. */
export interface DashboardAppDependencies {
  dashboard: DashboardService;
  /**
   * Declared as the two methods it calls rather than the whole automation
   * service: a chart card shows the trigger watching it, and Dashboard depends
   * on nothing else Automation owns.
   */
  automation: DashboardGraphAlertLookup;
}

export class DashboardApp {
  static create(dependencies: DashboardAppDependencies): DashboardApp {
    return new DashboardApp(dependencies);
  }

  private constructor(private readonly dependencies: DashboardAppDependencies) {}

  // -- dashboards ------------------------------------------------------------

  /** The project's dashboards, each with the number of cards its grid renders. */
  getAll(input: {
    projectId: string;
    graphCountScope: DashboardGraphCountScope;
  }): Promise<DashboardSummary[]> {
    return this.named(input.projectId, () => this.dependencies.dashboard.getAll(input));
  }

  /** One dashboard with its graphs, in grid order. */
  getById(input: {
    projectId: string;
    dashboardId: string;
  }): Promise<Dashboard & { graphs: Graph[] }> {
    return this.named(input.projectId, () => this.dependencies.dashboard.getById(input));
  }

  /** A new dashboard, appended after the current last. */
  create(input: { projectId: string; name: string }): Promise<Dashboard> {
    return this.named(input.projectId, () => this.dependencies.dashboard.create(input));
  }

  /** A dashboard's name. */
  rename(input: { projectId: string; dashboardId: string; name: string }): Promise<Dashboard> {
    return this.named(input.projectId, () => this.dependencies.dashboard.rename(input));
  }

  /** Removes a dashboard, cascading to its graphs. */
  delete(input: { projectId: string; dashboardId: string }): Promise<Dashboard> {
    return this.named(input.projectId, () => this.dependencies.dashboard.delete(input));
  }

  /** The order the navigation lists them in. */
  reorder(input: { projectId: string; dashboardIds: string[] }): Promise<{ success: true }> {
    return this.named(input.projectId, () => this.dependencies.dashboard.reorder(input));
  }

  /** The project's first dashboard, created on demand. */
  getOrCreateFirst(input: { projectId: string }): Promise<Dashboard> {
    return this.named(input.projectId, () => this.dependencies.dashboard.getOrCreateFirst(input));
  }

  // -- graphs ----------------------------------------------------------------

  /** The project's chart-builder graphs, optionally on one dashboard. */
  listGraphs(input: { projectId: string; dashboardId?: string }): Promise<Graph[]> {
    return this.named(input.projectId, () => this.dependencies.dashboard.listGraphs(input));
  }

  /** One graph. */
  getGraph(input: { projectId: string; graphId: string }): Promise<Graph> {
    return this.named(input.projectId, () => this.dependencies.dashboard.getGraph(input));
  }

  /** A new chart on a dashboard, at a grid position. */
  createGraph(input: {
    projectId: string;
    name: string;
    graph: Record<string, unknown>;
    filters?: Record<string, unknown>;
    dashboardId?: string;
    layout?: Partial<GraphLayout>;
  }): Promise<Graph> {
    return this.named(input.projectId, () => this.dependencies.dashboard.createGraph(input));
  }

  /** A chart's name, payload, or filters. */
  updateGraph(input: {
    projectId: string;
    graphId: string;
    name?: string;
    graph?: Record<string, unknown>;
    filters?: Record<string, unknown>;
  }): Promise<Graph> {
    return this.named(input.projectId, () => this.dependencies.dashboard.updateGraph(input));
  }

  /** Removes one chart. */
  deleteGraph(input: { projectId: string; graphId: string }): Promise<Graph> {
    return this.named(input.projectId, () => this.dependencies.dashboard.deleteGraph(input));
  }

  /** One chart's grid position. */
  updateGraphLayout(input: {
    projectId: string;
    graphId: string;
    layout: GraphLayout;
  }): Promise<Graph> {
    return this.named(input.projectId, () => this.dependencies.dashboard.updateGraphLayout(input));
  }

  /** The whole grid after a drag. */
  batchUpdateGraphLayouts(input: {
    projectId: string;
    layouts: Array<{ graphId: string; layout: GraphLayout }>;
  }): Promise<{ success: true }> {
    return this.named(input.projectId, () =>
      this.dependencies.dashboard.batchUpdateGraphLayouts(input),
    );
  }

  // -- the alert watching a graph -------------------------------------------

  /** The alert automations watching a set of charts. */
  getAlertsForGraphs(input: { projectId: string; customGraphIds: string[] }): Promise<Trigger[]> {
    return this.dependencies.automation.getByCustomGraphIds(input);
  }

  /** The alert automation watching one chart, if any. */
  tryGetAlertForGraph(input: {
    projectId: string;
    customGraphId: string;
  }): Promise<Trigger | null> {
    return this.dependencies.automation.tryGetByCustomGraphId(input);
  }

  // -- saved LangWatchQL workbench charts ------------------------------------

  /** Every saved chart in the project. */
  listSavedWorkbenchCharts(input: { projectId: string }): Promise<SavedWorkbenchChart[]> {
    return this.named(input.projectId, () =>
      this.dependencies.dashboard.listSavedWorkbenchCharts(input),
    );
  }

  /** One saved chart, with its query, parameters and specification. */
  getSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
  }): Promise<SavedWorkbenchChart> {
    return this.named(input.projectId, () =>
      this.dependencies.dashboard.getSavedWorkbenchChart(input),
    );
  }

  /** A new saved chart. */
  createSavedWorkbenchChart(input: {
    projectId: string;
    protections: LangWatchQLProtections;
    name: string;
    definition: unknown;
    id?: string;
  }): Promise<SavedWorkbenchChart> {
    return this.named(input.projectId, () =>
      this.dependencies.dashboard.createSavedWorkbenchChart(input),
    );
  }

  /** A saved chart's name, its definition, or both. */
  updateSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    name?: string;
    definitionUpdate?: SavedWorkbenchChartDefinitionUpdate;
  }): Promise<SavedWorkbenchChart> {
    return this.named(input.projectId, () =>
      this.dependencies.dashboard.updateSavedWorkbenchChart(input),
    );
  }

  /** Removes one saved chart. */
  deleteSavedWorkbenchChart(input: { projectId: string; chartId: string }): Promise<void> {
    return this.named(input.projectId, () =>
      this.dependencies.dashboard.deleteSavedWorkbenchChart(input),
    );
  }

  /**
   * Puts one saved chart on a dashboard, at a grid position when the caller
   * names one.
   *
   * Placement is a property of the chart rather than of the dashboard's own
   * card list: a saved chart carries its dashboard id and grid box, so this is
   * a write on the chart and belongs beside the rest of its lifecycle.
   */
  placeSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    dashboardId: string;
    gridColumn?: number;
    gridRow?: number;
    colSpan?: number;
    rowSpan?: number;
  }): Promise<SavedWorkbenchChart> {
    return this.named(input.projectId, () =>
      this.dependencies.dashboard.placeSavedWorkbenchChart(input),
    );
  }

  /**
   * Takes one saved chart off whatever dashboard it is on, clearing its grid
   * box with it. The chart itself is untouched.
   */
  unplaceSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
  }): Promise<SavedWorkbenchChart> {
    return this.named(input.projectId, () =>
      this.dependencies.dashboard.unplaceSavedWorkbenchChart(input),
    );
  }

  /** Runs one saved chart, for the period the surface asks for. */
  runSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    execution: LangWatchQLRunContext;
  }): Promise<LangWatchQLQueryResult> {
    return this.named(input.projectId, () =>
      this.dependencies.dashboard.runSavedWorkbenchChart(input),
    );
  }

  // -- naming the refusals ---------------------------------------------------

  /**
   * Runs one service call and re-raises its named absences on the typed
   * channel.
   *
   * Everything else is re-raised exactly as it arrived: an unanticipated
   * failure degrades to "unknown" plus a trace id at the boundary (ADR-045),
   * which is correct. A saved chart's own refusals are already `HandledError`s
   * raised by the service, so they pass through untouched.
   */
  private async named<T>(projectId: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof DashboardNotFoundError) throw new DashboardNotThereError(projectId);
      if (error instanceof GraphNotFoundError) throw new GraphNotThereError(projectId);
      if (error instanceof DashboardReorderError) {
        throw new DashboardReorderUnknownIdsError(error.missingIds);
      }
      throw error;
    }
  }
}
