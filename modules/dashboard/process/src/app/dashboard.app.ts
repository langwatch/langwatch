/**
 * The dashboard feature's application: what its doors call. It holds the
 * services, peers and ports the feature reaches, making here the decisions
 * each transport used to make itself: alert redaction, who's asking, dashboard address.
 */
import {
  AnalyticsApi,
  LangWatchQLNotEnabledError,
  type AnalyticsApi as AnalyticsApiContract,
  type DashboardWidget,
  type DashboardWidgetDefinitionInput,
  type LangWatchQLBudgetOverflowMode,
  type LangWatchQLCaller,
  type LangWatchQLProtections,
  type LangWatchQLQueryResult,
  type LangWatchQLTimeWindow,
} from "@langwatch/analytics-contract";
import {
  AutomationApi,
  type AutomationApi as AutomationApiContract,
  type Trigger,
} from "@langwatch/automation-contract";
import {
  DashboardApi,
  DashboardsNotEnabledError,
  SavedWorkbenchChartDashboardNotFoundError,
  dashboardConfig,
  type Dashboard,
  type DashboardStar,
  type StarredDashboard,
  type DashboardGraphCountScope,
  type DashboardSourcePresence,
  type DashboardSummary,
  type DashboardViewer,
  type Graph,
  type GraphLayout,
  type SavedView,
  type SavedViewJson,
  type SavedViewPeriod,
  type SavedWorkbenchChart,
  type SavedWorkbenchChartDefinitionUpdate,
  type DashboardUsageCount,
  type DashboardServerConfig,
} from "@langwatch/dashboard-contract";
import type { FeatureSetup } from "@langwatch/process";
import { ProjectApi, type ProjectApi as ProjectApiContract } from "@langwatch/project-contract";

import type { DashboardRepositories } from "../repositories/dashboard.repositories.ts";
import { dashboardPlatformUrl } from "../rules/dashboard-platform-url.rules.ts";
import { DashboardWidgetService } from "../services/dashboard-widget.service.ts";
import { DashboardService, type WorkbenchAccess } from "../services/dashboard.service.ts";
import { SavedViewService } from "../services/saved-view.service.ts";
import { SavedWorkbenchChartPolicyService } from "../services/saved-workbench-chart-policy.service.ts";
import { SavedWorkbenchChartService } from "../services/saved-workbench-chart.service.ts";
import { SourcePresenceService } from "../services/source-presence.service.ts";

type DashboardDependencies = Readonly<{
  analytics: typeof AnalyticsApi;
  automation: typeof AutomationApi;
  projects: typeof ProjectApi;
}>;

type DashboardSetup = FeatureSetup<
  DashboardDependencies,
  DashboardServerConfig,
  DashboardRepositories
>;

/** The member's own content protections, and the identity a session-authenticated run uses. */
interface WorkbenchCaller {
  resolveProtections(input: {
    actorId: string;
    projectId: string;
  }): Promise<LangWatchQLProtections>;
  resolveRunCaller(input: {
    actorId: string;
    projectId: string;
  }): Promise<Readonly<{ project: LangWatchQLCaller; protections: LangWatchQLProtections }>>;
}

/** The `release_dashboards` rollout, resolved for one project. */
interface DashboardsRollout {
  isDashboardsEnabled(input: { projectId: string }): Promise<boolean>;
}

/**
 * Thin adapter to AnalyticsApi: forwards rollout gate and RBAC checks while
 * adapting actorId naming to userId (AnalyticsApi owns protection logic).
 */
class AnalyticsWorkbenchAccess implements WorkbenchAccess {
  constructor(private readonly analytics: AnalyticsApiContract) {}

  isWorkbenchEnabled(input: { projectId: string }): Promise<boolean> {
    return this.analytics.isWorkbenchEnabled(input);
  }
}

class AnalyticsWorkbenchCaller implements WorkbenchCaller {
  constructor(private readonly analytics: AnalyticsApiContract) {}

  resolveProtections(input: { actorId: string; projectId: string }) {
    return this.analytics.resolveProtections({
      userId: input.actorId,
      projectId: input.projectId,
    });
  }

  resolveRunCaller(input: { actorId: string; projectId: string }) {
    return this.analytics.resolveRunCaller({
      userId: input.actorId,
      projectId: input.projectId,
    });
  }
}

/**
 * `release_dashboards`, answered by Analytics, which owns the reporting area's
 * rollout flags — the same peer the Workbench gate is composed from.
 */
class AnalyticsDashboardsRollout implements DashboardsRollout {
  constructor(private readonly analytics: AnalyticsApiContract) {}

  isDashboardsEnabled(input: { projectId: string }): Promise<boolean> {
    return this.analytics.isDashboardsEnabled(input);
  }
}

export class DashboardModule implements DashboardApi {
  static readonly contract = DashboardApi;
  static readonly dependencies = {
    analytics: AnalyticsApi,
    automation: AutomationApi,
    projects: ProjectApi,
  };
  /** The shared deployment origin, absent where the deployment named no `BASE_HOST`. */
  static readonly config = dashboardConfig;

  #dashboards: DashboardService;
  #charts: SavedWorkbenchChartService;
  #savedViews: SavedViewService;
  #widgets: DashboardWidgetService;
  #sourcePresence: SourcePresenceService;
  #rollout: DashboardsRollout;
  #analytics: AnalyticsApiContract;
  #automation: AutomationApiContract;
  #projects: ProjectApiContract;
  #workbenchAccess: WorkbenchAccess;
  #workbenchCaller: WorkbenchCaller;
  readonly #publicBaseUrl: string | undefined;

  private constructor({
    services,
    peers,
    workbench,
    rollout,
    publicBaseUrl,
  }: Readonly<{
    services: Readonly<{
      dashboards: DashboardService;
      charts: SavedWorkbenchChartService;
      savedViews: SavedViewService;
      widgets: DashboardWidgetService;
      sourcePresence: SourcePresenceService;
    }>;
    peers: Readonly<{
      analytics: AnalyticsApiContract;
      automation: AutomationApiContract;
      projects: ProjectApiContract;
    }>;
    workbench: Readonly<{ access: WorkbenchAccess; caller: WorkbenchCaller }>;
    rollout: DashboardsRollout;
    publicBaseUrl: string | undefined;
  }>) {
    this.#dashboards = services.dashboards;
    this.#charts = services.charts;
    this.#savedViews = services.savedViews;
    this.#widgets = services.widgets;
    this.#sourcePresence = services.sourcePresence;
    this.#rollout = rollout;
    this.#analytics = peers.analytics;
    this.#automation = peers.automation;
    this.#projects = peers.projects;
    this.#workbenchAccess = workbench.access;
    this.#workbenchCaller = workbench.caller;
    this.#publicBaseUrl = publicBaseUrl;
  }

  static create(setup: DashboardSetup): DashboardModule {
    const analytics: AnalyticsApiContract = setup.dependencies.analytics;
    const workbenchAccess = new AnalyticsWorkbenchAccess(analytics);
    const workbenchCaller = new AnalyticsWorkbenchCaller(analytics);
    const dashboards = DashboardService.create({
      repository: setup.repositories.dashboards,
      workbenchAccess,
    });

    return new DashboardModule({
      services: {
        dashboards,
        charts: SavedWorkbenchChartService.create({
          repository: setup.repositories.dashboards,
          policy: SavedWorkbenchChartPolicyService.create({ analytics }),
          analytics,
        }),
        savedViews: SavedViewService.create({ repository: setup.repositories.savedViews }),
        widgets: DashboardWidgetService.create({
          repository: setup.repositories.dashboardWidgets,
          analytics,
          boards: dashboards,
        }),
        sourcePresence: SourcePresenceService.create({ analytics }),
      },
      peers: {
        analytics,
        automation: setup.dependencies.automation,
        projects: setup.dependencies.projects,
      },
      workbench: { access: workbenchAccess, caller: workbenchCaller },
      rollout: new AnalyticsDashboardsRollout(analytics),
      publicBaseUrl: setup.config.publicBaseUrl,
    });
  }

  // -- dashboards ------------------------------------------------------------

  /** The project's dashboards, each with the number of cards its grid renders. */
  countUsage(input: { projectIds: readonly string[] }): Promise<DashboardUsageCount> {
    return this.#dashboards.countUsage(input);
  }

  /** The boards the viewer may see, each with the number of cards its grid renders. */
  getAll(input: {
    projectId: string;
    graphCountScope: DashboardGraphCountScope;
    viewer?: DashboardViewer;
  }): Promise<DashboardSummary[]> {
    return this.#dashboards.getAll(input);
  }

  /** One dashboard with its graphs, in grid order. */
  getById(input: {
    projectId: string;
    dashboardId: string;
    viewer?: DashboardViewer;
  }): Promise<Dashboard & { graphs: Graph[] }> {
    return this.#dashboards.getById(input);
  }

  /** A new dashboard, appended after the current last. */
  create(input: { projectId: string; name: string; createdById?: string }): Promise<Dashboard> {
    return this.#dashboards.create(input);
  }

  /** A dashboard's name. */
  rename(input: {
    projectId: string;
    dashboardId: string;
    name: string;
    viewer?: DashboardViewer;
  }): Promise<Dashboard> {
    return this.#dashboards.rename(input);
  }

  /** Removes a dashboard, cascading to its graphs and every member's star of it. */
  delete(input: {
    projectId: string;
    dashboardId: string;
    viewer?: DashboardViewer;
  }): Promise<Dashboard> {
    return this.#dashboards.delete(input);
  }

  /** The legacy board `order`; written only by the REST reorder endpoint. */
  reorder(input: {
    projectId: string;
    dashboardIds: string[];
    viewer?: DashboardViewer;
  }): Promise<{ success: true }> {
    return this.#dashboards.reorder(input);
  }

  /** The viewer's first dashboard, created on demand. */
  getOrCreateFirst(input: { projectId: string; viewer?: DashboardViewer }): Promise<Dashboard> {
    return this.#dashboards.getOrCreateFirst(input);
  }

  /** The member's stars (boards and templates) for this project, in their own order. */
  listStarred(input: { projectId: string; userId: string }): Promise<StarredDashboard[]> {
    return this.#dashboards.listStarred(input);
  }

  /** Stars a board or template for the member; appends at the end and is idempotent. */
  star(input: {
    projectId: string;
    userId: string;
    star: DashboardStar;
  }): Promise<{ success: true }> {
    return this.#dashboards.star(input);
  }

  unstar(input: {
    projectId: string;
    userId: string;
    star: DashboardStar;
  }): Promise<{ success: true }> {
    return this.#dashboards.unstar(input);
  }

  /** Rewrites the member's star order from the stars given, in the order given. */
  reorderStars(input: {
    projectId: string;
    userId: string;
    stars: DashboardStar[];
  }): Promise<{ success: true }> {
    return this.#dashboards.reorderStars(input);
  }

  /** Where a reader opens each of these dashboards. */
  async getDashboardLinks(input: {
    projectId: string;
    dashboardIds: string[];
  }): Promise<Record<string, string>> {
    const project = await this.#projects.findSummaryById(input.projectId);
    if (!project) throw new Error(`Project ${input.projectId} has no summary to link against`);

    return Object.fromEntries(
      input.dashboardIds.map((dashboardId) => [
        dashboardId,
        dashboardPlatformUrl({
          publicBaseUrl: this.#publicBaseUrl,
          projectSlug: project.slug,
          path: `/analytics/reports?dashboard=${dashboardId}`,
        }),
      ]),
    );
  }

  // -- the Dashboards area (`release_dashboards`) -----------------------------

  /** A board's inline name and description. */
  async updateDashboardDetails(input: {
    projectId: string;
    dashboardId: string;
    viewer: DashboardViewer;
    name?: string;
    description?: string | null;
  }): Promise<Dashboard> {
    await this.#requireDashboardsEnabled(input.projectId);
    return this.#dashboards.updateDetails(input);
  }

  /** Whether each Flight Deck source ever recorded a row, as this member reads the project. */
  async getSourcePresence(input: {
    projectId: string;
    viewer: DashboardViewer;
  }): Promise<DashboardSourcePresence> {
    await this.#requireDashboardsEnabled(input.projectId);
    return this.#sourcePresence.getPresence({
      projectId: input.projectId,
      userId: input.viewer.userId,
    });
  }

  async #requireDashboardsEnabled(projectId: string): Promise<void> {
    if (!(await this.#rollout.isDashboardsEnabled({ projectId }))) {
      throw new DashboardsNotEnabledError();
    }
  }

  // -- graphs ----------------------------------------------------------------

  /** The project's chart-builder graphs the viewer may see, optionally on one dashboard. */
  listGraphs(input: {
    projectId: string;
    dashboardId?: string;
    viewer?: DashboardViewer;
  }): Promise<Graph[]> {
    return this.#dashboards.listGraphs(input);
  }

  /** One graph. */
  getGraph(input: {
    projectId: string;
    graphId: string;
    viewer?: DashboardViewer;
  }): Promise<Graph> {
    return this.#dashboards.getGraph(input);
  }

  /** A new chart on a dashboard, at a grid position. */
  createGraph(input: {
    projectId: string;
    name: string;
    graph: Record<string, unknown>;
    filters?: Record<string, unknown>;
    dashboardId?: string;
    layout?: Partial<GraphLayout>;
    viewer?: DashboardViewer;
  }): Promise<Graph> {
    return this.#dashboards.createGraph(input);
  }

  /** A chart's name, payload, or filters. */
  updateGraph(input: {
    projectId: string;
    graphId: string;
    name?: string;
    graph?: Record<string, unknown>;
    filters?: Record<string, unknown>;
    viewer?: DashboardViewer;
  }): Promise<Graph> {
    return this.#dashboards.updateGraph(input);
  }

  /** Removes one chart. */
  deleteGraph(input: {
    projectId: string;
    graphId: string;
    viewer?: DashboardViewer;
  }): Promise<Graph> {
    return this.#dashboards.deleteGraph(input);
  }

  /** One chart's grid position. */
  updateGraphLayout(input: {
    projectId: string;
    graphId: string;
    layout: GraphLayout;
    viewer?: DashboardViewer;
  }): Promise<Graph> {
    return this.#dashboards.updateGraphLayout(input);
  }

  /** The whole grid after a drag. */
  batchUpdateGraphLayouts(input: {
    projectId: string;
    layouts: { graphId: string; layout: GraphLayout }[];
    viewer?: DashboardViewer;
  }): Promise<{ success: true }> {
    return this.#dashboards.batchUpdateGraphLayouts(input);
  }

  // -- custom chart widgets --------------------------------------------------

  /**
   * The rollout gate over the widget surface. Analytics owns what a widget
   * means, so it owns whether the project may author one at all.
   */
  assertCustomChartPlaygroundEnabled(input: { projectId: string }): Promise<void> {
    return this.#analytics.assertCustomChartPlaygroundEnabled(input);
  }

  /** The project's custom chart widgets. */
  listDashboardWidgets(input: {
    projectId: string;
    viewer?: DashboardViewer;
  }): Promise<DashboardWidget[]> {
    return this.#widgets.getAll(input);
  }

  /** One custom chart widget. */
  getDashboardWidget(input: {
    projectId: string;
    id: string;
    viewer?: DashboardViewer;
  }): Promise<DashboardWidget> {
    return this.#widgets.getById(input);
  }

  /** A new widget, on the dashboard named or on the unplaced authoring grid. */
  async createDashboardWidget(
    input: {
      projectId: string;
      dashboardId?: string;
      name: string;
      viewer?: DashboardViewer;
    } & DashboardWidgetDefinitionInput,
  ): Promise<DashboardWidget> {
    return this.#widgets.createWidget({
      projectId: input.projectId,
      ...(input.dashboardId === undefined ? {} : { dashboardId: input.dashboardId }),
      input: {
        name: input.name,
        code: input.code,
        queries: input.queries,
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
        ...(input.source === undefined ? {} : { source: input.source }),
      },
      viewer: input.viewer,
    });
  }

  /** A widget's name, code, queries, description, prompt or source; the rest is kept. */
  updateDashboardWidget(
    input: {
      projectId: string;
      id: string;
      name?: string;
      viewer?: DashboardViewer;
    } & Partial<DashboardWidgetDefinitionInput>,
  ): Promise<DashboardWidget> {
    return this.#widgets.updateWidget({
      projectId: input.projectId,
      id: input.id,
      viewer: input.viewer,
      input: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.code === undefined ? {} : { code: input.code }),
        ...(input.queries === undefined ? {} : { queries: input.queries }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
        ...(input.source === undefined ? {} : { source: input.source }),
      },
    });
  }

  /** Puts one widget on a dashboard, below whatever it would collide with. */
  async assignDashboardWidgetToDashboard(input: {
    projectId: string;
    id: string;
    dashboardId: string;
    viewer?: DashboardViewer;
  }): Promise<DashboardWidget> {
    return this.#widgets.assignToDashboard(input);
  }

  /** Removes one widget. */
  deleteDashboardWidget(input: {
    projectId: string;
    id: string;
    viewer?: DashboardViewer;
  }): Promise<void> {
    return this.#widgets.deleteWidget(input);
  }

  /** Moves or resizes one widget; an id naming no widget here changes nothing. */
  async updateDashboardWidgetLayout(input: {
    projectId: string;
    graphId: string;
    layout: GraphLayout;
    viewer?: DashboardViewer;
  }): Promise<{ success: true }> {
    await this.#widgets.updateLayouts({
      projectId: input.projectId,
      layouts: [{ graphId: input.graphId, layout: input.layout }],
      viewer: input.viewer,
    });
    return { success: true };
  }

  /** Moves or resizes several widgets together; ids naming no widget here change nothing. */
  async batchUpdateDashboardWidgetLayouts(input: {
    projectId: string;
    layouts: { graphId: string; layout: GraphLayout }[];
    viewer?: DashboardViewer;
  }): Promise<{ success: true }> {
    await this.#widgets.updateLayouts(input);
    return { success: true };
  }

  /** Where a reader opens the dashboards list a widget lands on. */
  dashboardWidgetPlatformUrl(input: { projectSlug: string }): string {
    return dashboardPlatformUrl({
      publicBaseUrl: this.#publicBaseUrl,
      projectSlug: input.projectSlug,
      path: "/analytics/reports",
    });
  }

  // -- the alert watching a graph -------------------------------------------

  /** The alerts watching a set of charts, with their provider secrets stripped. */
  async getAlertsForGraphs(input: {
    projectId: string;
    customGraphIds: string[];
  }): Promise<Trigger[]> {
    const triggers = await this.#automation.getByCustomGraphIds(input);

    return triggers.map((trigger) => this.#redacted(trigger));
  }

  /**
   * The alert watching one chart, when a live one does; secrets stripped. An
   * alert switched off or deleted is not one, so a card reads nothing there.
   */
  async findAlertForGraph(input: {
    projectId: string;
    customGraphId: string;
  }): Promise<Trigger | undefined> {
    const trigger = await this.#automation.findByCustomGraphId(input);
    if (trigger === null || !trigger.active || trigger.deleted) return undefined;

    return this.#redacted(trigger);
  }

  // -- saved LangWatchQL workbench charts ------------------------------------

  /** The experimental gate over the whole workbench surface, asked per request. */
  isWorkbenchEnabled(input: { projectId: string }): Promise<boolean> {
    return this.#workbenchAccess.isWorkbenchEnabled(input);
  }

  /** The project's saved charts. */
  async listSavedWorkbenchCharts(input: {
    projectId: string;
    viewer?: DashboardViewer;
  }): Promise<SavedWorkbenchChart[]> {
    await this.#requireWorkbench(input.projectId);

    return this.#charts.getAll({ projectId: input.projectId });
  }

  /** One saved chart, with its query, parameters and specification. */
  async getSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    viewer?: DashboardViewer;
  }): Promise<SavedWorkbenchChart> {
    await this.#requireWorkbench(input.projectId);

    return this.#getVisibleChart(input);
  }

  /** A new saved chart, for a credential that resolved its own protections. */
  createSavedWorkbenchChart(input: {
    projectId: string;
    protections: LangWatchQLProtections;
    name: string;
    definition: unknown;
    id?: string;
  }): Promise<SavedWorkbenchChart> {
    return this.#charts.create(input);
  }

  /** A saved chart's name, its definition, or both. */
  async updateSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    name?: string;
    definitionUpdate?: SavedWorkbenchChartDefinitionUpdate;
    viewer?: DashboardViewer;
  }): Promise<SavedWorkbenchChart> {
    const { viewer: _viewer, ...update } = input;
    await this.#getVisibleChart(input);
    return this.#charts.update(update);
  }

  /**
   * A new saved chart for a signed-in member. Their own protections are
   * resolved for THIS request and decide what the statement may name: a member
   * who cannot read costs must not save a chart that selects them.
   */
  async createMemberSavedWorkbenchChart(input: {
    projectId: string;
    actorId: string;
    name: string;
    definition: unknown;
  }): Promise<SavedWorkbenchChart> {
    await this.#requireWorkbench(input.projectId);

    const protections = await this.#workbenchCaller.resolveProtections({
      actorId: input.actorId,
      projectId: input.projectId,
    });

    return this.#charts.create({
      projectId: input.projectId,
      protections,
      name: input.name,
      definition: input.definition,
    });
  }

  /**
   * A member's edit of a saved chart. Protections are resolved for this
   * request rather than remembered from the save, so a member whose
   * permissions narrowed cannot name a column they may no longer read.
   */
  async updateMemberSavedWorkbenchChart(input: {
    projectId: string;
    actorId: string;
    chartId: string;
    name?: string;
    definition?: unknown;
    viewer?: DashboardViewer;
  }): Promise<SavedWorkbenchChart> {
    await this.#requireWorkbench(input.projectId);
    await this.#getVisibleChart(input);

    const definitionUpdate =
      input.definition === undefined
        ? undefined
        : {
            definition: input.definition,
            protections: await this.#workbenchCaller.resolveProtections({
              actorId: input.actorId,
              projectId: input.projectId,
            }),
          };

    return this.#charts.update({
      projectId: input.projectId,
      chartId: input.chartId,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(definitionUpdate === undefined ? {} : { definitionUpdate }),
    });
  }

  /** Removes one saved chart. */
  async deleteSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    viewer?: DashboardViewer;
  }): Promise<void> {
    await this.#getVisibleChart(input);
    return this.#charts.delete({ projectId: input.projectId, chartId: input.chartId });
  }

  /**
   * Puts one saved chart on a dashboard, at a grid position when the caller
   * names one. Placement is a property of the chart rather than of the
   * dashboard's own card list.
   */
  async placeSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    dashboardId: string;
    gridColumn?: number;
    gridRow?: number;
    colSpan?: number;
    rowSpan?: number;
    viewer?: DashboardViewer;
  }): Promise<SavedWorkbenchChart> {
    const { viewer, ...placement } = input;
    const { projectId, chartId, dashboardId } = placement;
    if (!(await this.#dashboards.boardExists({ projectId, dashboardId }))) {
      throw new SavedWorkbenchChartDashboardNotFoundError();
    }
    await this.#getVisibleChart({ projectId, chartId, viewer });
    return this.#charts.place(placement);
  }

  /**
   * Takes one saved chart off whatever dashboard it is on, clearing its grid
   * box with it. The chart itself is untouched.
   */
  async unplaceSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    viewer?: DashboardViewer;
  }): Promise<SavedWorkbenchChart> {
    await this.#getVisibleChart(input);
    return this.#charts.unplace({ projectId: input.projectId, chartId: input.chartId });
  }

  /** A chart the project does not hold reads as not there. */
  async #getVisibleChart(input: {
    projectId: string;
    chartId: string;
    viewer?: DashboardViewer;
  }): Promise<SavedWorkbenchChart> {
    return this.#charts.getById({ projectId: input.projectId, chartId: input.chartId });
  }

  /** Runs one saved chart for a member, over the period the surface asks for. */
  async runSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    actorId: string;
    timeWindow?: LangWatchQLTimeWindow;
    granularitySeconds?: number;
    onBudgetOverflow?: LangWatchQLBudgetOverflowMode;
    viewer?: DashboardViewer;
  }): Promise<LangWatchQLQueryResult> {
    await this.#requireWorkbench(input.projectId);
    await this.#getVisibleChart(input);

    const { project, protections } = await this.#workbenchCaller.resolveRunCaller({
      actorId: input.actorId,
      projectId: input.projectId,
    });

    return this.#charts.run({
      projectId: input.projectId,
      chartId: input.chartId,
      execution: {
        project,
        protections,
        ...(input.timeWindow === undefined ? {} : { timeWindow: input.timeWindow }),
        ...(input.granularitySeconds === undefined
          ? {}
          : { granularitySeconds: input.granularitySeconds }),
        ...(input.onBudgetOverflow === undefined
          ? {}
          : { onBudgetOverflow: input.onBudgetOverflow }),
      },
    });
  }

  // -- saved views -----------------------------------------------------------

  /** The project's shared views plus the caller's own personal ones. */
  listSavedViews(input: {
    projectId: string;
    actorId: string;
    kind?: string;
  }): Promise<SavedView[]> {
    return this.#savedViews.getAll({
      projectId: input.projectId,
      userId: input.actorId,
      ...(input.kind === undefined ? {} : { kind: input.kind }),
    });
  }

  /** A new view, shared with the project or personal to the caller. */
  createSavedView(input: {
    projectId: string;
    actorId: string;
    id?: string;
    name: string;
    filters: Record<string, unknown>;
    query?: string;
    period?: SavedViewPeriod;
    personal: boolean;
    kind?: string;
  }): Promise<SavedView> {
    return this.#savedViews.createView({
      projectId: input.projectId,
      input: {
        ...(input.id === undefined ? {} : { id: input.id }),
        name: input.name,
        filters: input.filters as SavedViewJson,
        ...(input.query === undefined ? {} : { query: input.query }),
        ...(input.period === undefined ? {} : { period: input.period as SavedViewJson }),
        ...(input.personal ? { userId: input.actorId } : {}),
        ...(input.kind === undefined ? {} : { kind: input.kind }),
      },
    });
  }

  /** Removes one view; a personal view only for the member who owns it. */
  deleteSavedView(input: {
    projectId: string;
    actorId: string;
    viewId: string;
  }): Promise<SavedView> {
    return this.#savedViews.delete({
      projectId: input.projectId,
      viewId: input.viewId,
      userId: input.actorId,
    });
  }

  /** Renames one view, under the same ownership rule. */
  renameSavedView(input: {
    projectId: string;
    actorId: string;
    viewId: string;
    name: string;
  }): Promise<SavedView> {
    return this.#savedViews.rename({
      projectId: input.projectId,
      viewId: input.viewId,
      name: input.name,
      userId: input.actorId,
    });
  }

  /** The order the tab strip lists them in, under the same ownership rule. */
  reorderSavedViews(input: {
    projectId: string;
    actorId: string;
    viewIds: string[];
  }): Promise<{ success: true }> {
    return this.#savedViews.reorder({
      projectId: input.projectId,
      viewIds: input.viewIds,
      userId: input.actorId,
    });
  }

  /**
   * The workbench's rollout gate, asked after the door has placed the caller
   * by permission. Reads refuse too, and deliberately: a surface that listed
   * charts while the feature was off would announce what nobody can use.
   */
  async #requireWorkbench(projectId: string): Promise<void> {
    const enabled = await this.#workbenchAccess.isWorkbenchEnabled({ projectId });
    if (!enabled) throw new LangWatchQLNotEnabledError();
  }

  /**
   * One trigger with its action parameters stripped, always empty since the
   * per-provider redaction composition was deleted — this process composes
   * none, so no provider's stored secret ever leaves the server.
   */
  #redacted(trigger: Trigger): Trigger {
    return {
      ...trigger,
      actionParams: {},
    };
  }
}
