import {
  DashboardNotFoundError,
  DashboardReorderError,
  type DashboardGraphCountScope,
  type Dashboard,
  type DashboardSummary,
  DashboardService as DashboardServiceContract,
  type Graph,
  GraphNotFoundError,
  dashboardCreateInputSchema,
  dashboardIdSchema,
  dashboardRenameInputSchema,
  dashboardReorderInputSchema,
  graphCreateInputSchema,
  graphFiltersSchema,
  graphIdSchema,
  graphLayoutSchema,
  graphNameSchema,
  graphPayloadSchema,
  graphUpdateInputSchema,
  projectIdSchema,
  type GraphLayout,
  type SavedWorkbenchChart,
  type SavedWorkbenchChartDefinitionUpdate,
} from "@langwatch/dashboard-contract";
import {
  type LangWatchQLProtections,
  type LangWatchQLQueryResult,
  type LangWatchQLRunContext,
  type LangWatchQLService,
} from "@langwatch/analytics-contract";
import type {
  DashboardGraphVisibilityPolicyPort,
  DashboardIdGenerator,
  DashboardRepository,
  SavedWorkbenchChartPolicy,
} from "../ports/dashboard.port";
import { SavedWorkbenchChartService } from "./saved-workbench-chart.service";

const defaultLayout: GraphLayout = {
  gridColumn: 0,
  gridRow: 0,
  colSpan: 1,
  rowSpan: 1,
};

export class DashboardService extends DashboardServiceContract {
  private constructor(
    private readonly repository: DashboardRepository,
    private readonly ids: DashboardIdGenerator,
    private readonly graphVisibility: DashboardGraphVisibilityPolicyPort,
    private readonly savedWorkbenchCharts: SavedWorkbenchChartService,
  ) {
    super();
  }

  static create(options: {
    repository: DashboardRepository;
    ids: DashboardIdGenerator;
    savedWorkbenchChartPolicy: SavedWorkbenchChartPolicy;
    graphVisibility: DashboardGraphVisibilityPolicyPort;
    langWatchQL: LangWatchQLService;
  }): DashboardService {
    return new DashboardService(
      options.repository,
      options.ids,
      options.graphVisibility,
      SavedWorkbenchChartService.create(options),
    );
  }

  async getAll(input: {
    projectId: string;
    graphCountScope: DashboardGraphCountScope;
  }): Promise<DashboardSummary[]> {
    const parsed = DashboardService.parseProjectId(input.projectId);

    const graphKinds =
      input.graphCountScope === "builder"
        ? (["builder"] as const)
        : await this.graphVisibility.placeableKinds({ projectId: parsed });

    return this.repository.findAllDashboards({ projectId: parsed, graphKinds });
  }

  async getById(input: {
    projectId: string;
    dashboardId: string;
  }): Promise<Dashboard & { graphs: Graph[] }> {
    const parsed = DashboardService.dashboardRef(input);

    const dashboard = await this.repository.tryFindDashboard(parsed);
    if (!dashboard) {
      throw new DashboardNotFoundError();
    }

    return dashboard;
  }

  async create(input: { projectId: string; name: string }): Promise<Dashboard> {
    const parsed = dashboardCreateInputSchema.parse(input);

    const last = await this.repository.tryFindLastDashboard({
      projectId: parsed.projectId,
    });

    return this.repository.createDashboard({
      id: this.ids.generate(),
      projectId: parsed.projectId,
      name: parsed.name,
      order: (last?.order ?? -1) + 1,
    });
  }

  async rename(input: {
    projectId: string;
    dashboardId: string;
    name: string;
  }): Promise<Dashboard> {
    const parsed = dashboardRenameInputSchema.parse(input);

    await this.getById({ projectId: parsed.projectId, dashboardId: parsed.dashboardId });

    return this.repository.updateDashboard({
      projectId: parsed.projectId,
      dashboardId: parsed.dashboardId,
      data: { name: parsed.name },
    });
  }

  async delete(input: { projectId: string; dashboardId: string }): Promise<Dashboard> {
    const parsed = DashboardService.dashboardRef(input);

    await this.getById(parsed);

    return this.repository.deleteDashboard(parsed);
  }

  async reorder(input: { projectId: string; dashboardIds: string[] }): Promise<{ success: true }> {
    const parsed = dashboardReorderInputSchema.parse(input);

    const found = new Set(await this.repository.findDashboardIds(parsed));

    const missingIds = parsed.dashboardIds.filter((id) => !found.has(id));
    if (missingIds.length > 0) {
      throw new DashboardReorderError(missingIds);
    }

    await this.repository.updateDashboardOrder(parsed);

    return { success: true as const };
  }

  async getOrCreateFirst(input: { projectId: string }): Promise<Dashboard> {
    const projectId = DashboardService.parseProjectId(input.projectId);

    const first = await this.repository.tryFindFirstDashboard({ projectId });
    if (first) {
      return first;
    }

    return this.repository.createDashboard({
      id: this.ids.generate(),
      projectId,
      name: "Reports",
      order: 0,
    });
  }

  async listGraphs(input: { projectId: string; dashboardId?: string }): Promise<Graph[]> {
    const projectId = DashboardService.parseProjectId(input.projectId);

    const dashboardId =
      input.dashboardId === undefined ? undefined : dashboardIdSchema.parse(input.dashboardId);

    return this.repository.findAllGraphs({ projectId, dashboardId });
  }

  async getGraph(input: { projectId: string; graphId: string }): Promise<Graph> {
    const parsed = DashboardService.graphRef(input);

    const graph = await this.repository.tryFindGraph(parsed);
    if (!graph) {
      throw new GraphNotFoundError();
    }

    return graph;
  }

  async createGraph(input: {
    projectId: string;
    name: string;
    graph: Record<string, unknown>;
    filters?: Record<string, unknown>;
    dashboardId?: string;
    layout?: Partial<GraphLayout>;
  }): Promise<Graph> {
    const parsed = graphCreateInputSchema.parse({
      ...input,
      ...input.layout,
    });

    if (parsed.dashboardId !== undefined) {
      await this.getById({
        projectId: parsed.projectId,
        dashboardId: parsed.dashboardId,
      });
    }

    const lastGridRow =
      parsed.dashboardId === undefined
        ? null
        : await this.repository.tryFindLastGraphGridRow({
            projectId: parsed.projectId,
            dashboardId: parsed.dashboardId,
          });

    const layout = graphLayoutSchema.parse({
      ...defaultLayout,
      ...input.layout,
      ...(input.layout?.gridRow === undefined && parsed.dashboardId !== undefined
        ? { gridRow: (lastGridRow ?? -1) + 1 }
        : {}),
    });

    return this.repository.createGraph({
      id: this.ids.generate(),
      projectId: parsed.projectId,
      name: parsed.name,
      graph: graphPayloadSchema.parse(parsed.graph),
      filters: graphFiltersSchema.parse(parsed.filters ?? {}),
      dashboardId: parsed.dashboardId ?? null,
      layout,
    });
  }

  async updateGraph(input: {
    projectId: string;
    graphId: string;
    name?: string;
    graph?: Record<string, unknown>;
    filters?: Record<string, unknown>;
  }): Promise<Graph> {
    const parsed = graphUpdateInputSchema.parse(input);

    await this.getGraph({ projectId: parsed.projectId, graphId: parsed.graphId });

    return this.repository.updateGraph({
      projectId: parsed.projectId,
      graphId: parsed.graphId,
      ...(parsed.name === undefined ? {} : { name: graphNameSchema.parse(parsed.name) }),
      ...(parsed.graph === undefined ? {} : { graph: graphPayloadSchema.parse(parsed.graph) }),
      ...(parsed.filters === undefined
        ? {}
        : { filters: graphFiltersSchema.parse(parsed.filters) }),
    });
  }

  async deleteGraph(input: { projectId: string; graphId: string }): Promise<Graph> {
    const parsed = DashboardService.graphRef(input);

    await this.getGraph(parsed);

    return this.repository.deleteGraph(parsed);
  }

  async updateGraphLayout(input: {
    projectId: string;
    graphId: string;
    layout: GraphLayout;
  }): Promise<Graph> {
    const parsed = graphLayoutSchema.parse(input.layout);

    const ref = DashboardService.graphRef(input);

    await this.getGraph(ref);

    return this.repository.updateGraphLayout({ ...ref, layout: parsed });
  }

  async batchUpdateGraphLayouts(input: {
    projectId: string;
    layouts: Array<{ graphId: string; layout: GraphLayout }>;
  }): Promise<{ success: true }> {
    const projectId = DashboardService.parseProjectId(input.projectId);

    const layouts = input.layouts.map((item) => ({
      graphId: graphIdSchema.parse(item.graphId),
      layout: graphLayoutSchema.parse(item.layout),
    }));

    for (const item of layouts) {
      await this.getGraph({ projectId, graphId: item.graphId });
    }

    await this.repository.updateGraphLayouts({ projectId, layouts });

    return { success: true as const };
  }

  async listSavedWorkbenchCharts(input: { projectId: string }): Promise<SavedWorkbenchChart[]> {
    return this.savedWorkbenchCharts.getAll(input);
  }

  async getSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
  }): Promise<SavedWorkbenchChart> {
    return this.savedWorkbenchCharts.getById(input);
  }

  async createSavedWorkbenchChart(input: {
    projectId: string;
    protections: LangWatchQLProtections;
    name: string;
    definition: unknown;
    id?: string;
  }): Promise<SavedWorkbenchChart> {
    return this.savedWorkbenchCharts.create(input);
  }

  async updateSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    name?: string;
    definitionUpdate?: SavedWorkbenchChartDefinitionUpdate;
  }): Promise<SavedWorkbenchChart> {
    return this.savedWorkbenchCharts.update(input);
  }

  async deleteSavedWorkbenchChart(input: { projectId: string; chartId: string }): Promise<void> {
    return this.savedWorkbenchCharts.delete(input);
  }

  async placeSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    dashboardId: string;
    gridColumn?: number;
    gridRow?: number;
    colSpan?: number;
    rowSpan?: number;
  }): Promise<SavedWorkbenchChart> {
    return this.savedWorkbenchCharts.place(input);
  }

  async unplaceSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
  }): Promise<SavedWorkbenchChart> {
    return this.savedWorkbenchCharts.unplace(input);
  }

  async runSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    execution: LangWatchQLRunContext;
  }): Promise<LangWatchQLQueryResult> {
    return this.savedWorkbenchCharts.run(input);
  }

  private static parseProjectId(projectId: string): string {
    return projectIdSchema.parse(projectId);
  }

  private static dashboardRef(input: { projectId: string; dashboardId: string }) {
    return {
      projectId: DashboardService.parseProjectId(input.projectId),
      dashboardId: dashboardIdSchema.parse(input.dashboardId),
    };
  }

  private static graphRef(input: { projectId: string; graphId: string }) {
    return {
      projectId: DashboardService.parseProjectId(input.projectId),
      graphId: graphIdSchema.parse(input.graphId),
    };
  }
}
