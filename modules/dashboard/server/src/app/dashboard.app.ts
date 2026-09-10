/**
 * The dashboard feature's application: what its doors call. It holds the
 * services, peers and ports the feature reaches, and it makes here the
 * decisions each transport used to make for itself — the alert a graph
 * carries and its redaction, who is asking, and where a dashboard opens.
 */
import {
  AnalyticsApi,
  LangWatchQLNotEnabledError,
  type AnalyticsApi as AnalyticsApiContract,
  type LangWatchQLBudgetOverflowMode,
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
  type Dashboard,
  type DashboardGraphCountScope,
  type DashboardSummary,
  type Graph,
  type GraphLayout,
  type SavedView,
  type SavedViewJson,
  type SavedViewPeriod,
  type SavedWorkbenchChart,
  type SavedWorkbenchChartDefinitionUpdate,
} from "@langwatch/dashboard-contract";
import { ProjectApi, type ProjectApi as ProjectApiContract } from "@langwatch/project-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";

import type { AlertRedactionPort } from "../ports/alert-redaction.port.ts";
import type { PlatformUrlPort } from "../ports/platform-url.port.ts";
import type { WorkbenchAccessPort } from "../ports/workbench-access.port.ts";
import type { WorkbenchCallerPort } from "../ports/workbench-caller.port.ts";
import type { DashboardRepositories } from "../repositories/dashboard.repositories.ts";
import { DashboardService } from "../services/dashboard.service.ts";
import { SavedViewService } from "../services/saved-view.service.ts";
import { SavedWorkbenchChartPolicyService } from "../services/saved-workbench-chart-policy.service.ts";
import { SavedWorkbenchChartService } from "../services/saved-workbench-chart.service.ts";

/** What the deployment answers that Dashboard cannot answer for itself. */
export type DashboardInfrastructure = Readonly<{
  workbenchAccess: WorkbenchAccessPort;
  workbenchCaller: WorkbenchCallerPort;
  alertRedaction: AlertRedactionPort;
  platformUrl: PlatformUrlPort;
}>;

type DashboardDependencies = Readonly<{
  analytics: typeof AnalyticsApi;
  automation: typeof AutomationApi;
  projects: typeof ProjectApi;
}>;

type DashboardSetup = FeatureSetup<
  DashboardDependencies,
  DashboardInfrastructure,
  undefined,
  DashboardRepositories
>;

export class DashboardApp implements DashboardApi {
  static readonly contract = DashboardApi;
  static readonly dependencies = {
    analytics: AnalyticsApi,
    automation: AutomationApi,
    projects: ProjectApi,
  };

  #dashboards: DashboardService;
  #charts: SavedWorkbenchChartService;
  #savedViews: SavedViewService;
  #automation: AutomationApiContract;
  #projects: ProjectApiContract;
  #infrastructure: DashboardInfrastructure;

  private constructor(
    services: Readonly<{
      dashboards: DashboardService;
      charts: SavedWorkbenchChartService;
      savedViews: SavedViewService;
    }>,
    peers: Readonly<{ automation: AutomationApiContract; projects: ProjectApiContract }>,
    infrastructure: DashboardInfrastructure,
  ) {
    this.#dashboards = services.dashboards;
    this.#charts = services.charts;
    this.#savedViews = services.savedViews;
    this.#automation = peers.automation;
    this.#projects = peers.projects;
    this.#infrastructure = infrastructure;
  }

  static create(setup: DashboardSetup): DashboardApp {
    const analytics: AnalyticsApiContract = setup.dependencies.analytics;

    return new DashboardApp(
      {
        dashboards: DashboardService.create({
          repository: setup.repositories.dashboards,
          workbenchAccess: setup.infrastructure.workbenchAccess,
        }),
        charts: SavedWorkbenchChartService.create({
          repository: setup.repositories.dashboards,
          policy: SavedWorkbenchChartPolicyService.create({ analytics }),
          analytics,
        }),
        savedViews: SavedViewService.create({ repository: setup.repositories.savedViews }),
      },
      { automation: setup.dependencies.automation, projects: setup.dependencies.projects },
      setup.infrastructure,
    );
  }

  // -- dashboards ------------------------------------------------------------

  /** The project's dashboards, each with the number of cards its grid renders. */
  getAll(input: {
    projectId: string;
    graphCountScope: DashboardGraphCountScope;
  }): Promise<DashboardSummary[]> {
    return this.#dashboards.getAll(input);
  }

  /** One dashboard with its graphs, in grid order. */
  getById(input: {
    projectId: string;
    dashboardId: string;
  }): Promise<Dashboard & { graphs: Graph[] }> {
    return this.#dashboards.getById(input);
  }

  /** A new dashboard, appended after the current last. */
  create(input: { projectId: string; name: string }): Promise<Dashboard> {
    return this.#dashboards.create(input);
  }

  /** A dashboard's name. */
  rename(input: { projectId: string; dashboardId: string; name: string }): Promise<Dashboard> {
    return this.#dashboards.rename(input);
  }

  /** Removes a dashboard, cascading to its graphs. */
  delete(input: { projectId: string; dashboardId: string }): Promise<Dashboard> {
    return this.#dashboards.delete(input);
  }

  /** The order the navigation lists them in. */
  reorder(input: { projectId: string; dashboardIds: string[] }): Promise<{ success: true }> {
    return this.#dashboards.reorder(input);
  }

  /** The project's first dashboard, created on demand. */
  getOrCreateFirst(input: { projectId: string }): Promise<Dashboard> {
    return this.#dashboards.getOrCreateFirst(input);
  }

  /** Where a reader opens each of these dashboards. */
  async getDashboardLinks(input: {
    projectId: string;
    dashboardIds: string[];
  }): Promise<Record<string, string>> {
    const project = await this.#projects.tryGetSummaryById(input.projectId);
    if (!project) throw new Error(`Project ${input.projectId} has no summary to link against`);

    return Object.fromEntries(
      input.dashboardIds.map((dashboardId) => [
        dashboardId,
        this.#infrastructure.platformUrl.linkTo({
          projectSlug: project.slug,
          path: `/analytics/reports?dashboard=${dashboardId}`,
        }),
      ]),
    );
  }

  // -- graphs ----------------------------------------------------------------

  /** The project's chart-builder graphs, optionally on one dashboard. */
  listGraphs(input: { projectId: string; dashboardId?: string }): Promise<Graph[]> {
    return this.#dashboards.listGraphs(input);
  }

  /** One graph. */
  getGraph(input: { projectId: string; graphId: string }): Promise<Graph> {
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
  }): Promise<Graph> {
    return this.#dashboards.updateGraph(input);
  }

  /** Removes one chart. */
  deleteGraph(input: { projectId: string; graphId: string }): Promise<Graph> {
    return this.#dashboards.deleteGraph(input);
  }

  /** One chart's grid position. */
  updateGraphLayout(input: {
    projectId: string;
    graphId: string;
    layout: GraphLayout;
  }): Promise<Graph> {
    return this.#dashboards.updateGraphLayout(input);
  }

  /** The whole grid after a drag. */
  batchUpdateGraphLayouts(input: {
    projectId: string;
    layouts: Array<{ graphId: string; layout: GraphLayout }>;
  }): Promise<{ success: true }> {
    return this.#dashboards.batchUpdateGraphLayouts(input);
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

  /** Every saved chart in the project. */
  listSavedWorkbenchCharts(input: { projectId: string }): Promise<SavedWorkbenchChart[]> {
    return this.#charts.getAll(input);
  }

  /** One saved chart, with its query, parameters and specification. */
  getSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
  }): Promise<SavedWorkbenchChart> {
    return this.#charts.getById(input);
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
  updateSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    name?: string;
    definitionUpdate?: SavedWorkbenchChartDefinitionUpdate;
  }): Promise<SavedWorkbenchChart> {
    return this.#charts.update(input);
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

    const protections = await this.#infrastructure.workbenchCaller.resolveProtections({
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
  }): Promise<SavedWorkbenchChart> {
    await this.#requireWorkbench(input.projectId);

    const definitionUpdate =
      input.definition === undefined
        ? undefined
        : {
            definition: input.definition,
            protections: await this.#infrastructure.workbenchCaller.resolveProtections({
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
  deleteSavedWorkbenchChart(input: { projectId: string; chartId: string }): Promise<void> {
    return this.#charts.delete(input);
  }

  /**
   * Puts one saved chart on a dashboard, at a grid position when the caller
   * names one. Placement is a property of the chart rather than of the
   * dashboard's own card list.
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
    return this.#charts.place(input);
  }

  /**
   * Takes one saved chart off whatever dashboard it is on, clearing its grid
   * box with it. The chart itself is untouched.
   */
  unplaceSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
  }): Promise<SavedWorkbenchChart> {
    return this.#charts.unplace(input);
  }

  /** Runs one saved chart for a member, over the period the surface asks for. */
  async runSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    actorId: string;
    timeWindow?: LangWatchQLTimeWindow;
    granularitySeconds?: number;
    onBudgetOverflow?: LangWatchQLBudgetOverflowMode;
  }): Promise<LangWatchQLQueryResult> {
    await this.#requireWorkbench(input.projectId);

    const { project, protections } = await this.#infrastructure.workbenchCaller.resolveRunCaller({
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
    const enabled = await this.#infrastructure.workbenchAccess.isWorkbenchEnabled({ projectId });
    if (!enabled) throw new LangWatchQLNotEnabledError();
  }

  /** One trigger with the provider secrets its parameters carry stripped. */
  #redacted(trigger: Trigger): Trigger {
    return {
      ...trigger,
      actionParams: this.#infrastructure.alertRedaction.redactActionParams(
        trigger.action,
        trigger.actionParams ?? {},
      ),
    };
  }
}
