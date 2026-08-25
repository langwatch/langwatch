import {
  DashboardNotFoundError,
  DashboardReorderError,
  DashboardService as DashboardServiceContract,
  GraphNotFoundError,
  SavedWorkbenchChartDefinitionInvalidError,
  SavedWorkbenchChartNotFoundError,
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
  savedWorkbenchChartDefinitionSchema,
  savedWorkbenchChartIdSchema,
  savedWorkbenchChartNameSchema,
  type GraphLayout,
  type SavedWorkbenchChartDefinition,
} from "@langwatch/dashboard-contract";
import type {
  DashboardIdGenerator,
  DashboardRepository,
  SavedWorkbenchChartPolicy,
} from "../ports/dashboard.port";

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
    private readonly savedWorkbenchChartPolicy: SavedWorkbenchChartPolicy,
  ) {
    super();
  }

  static create(options: {
    repository: DashboardRepository;
    ids: DashboardIdGenerator;
    savedWorkbenchChartPolicy: SavedWorkbenchChartPolicy;
  }): DashboardService {
    return new DashboardService(
      options.repository,
      options.ids,
      options.savedWorkbenchChartPolicy,
    );
  }

  async getAll(input: { projectId: string }) {
    const parsed = zProjectId(input.projectId);
    return this.repository.findAllDashboards({ projectId: parsed });
  }

  async getById(input: { projectId: string; dashboardId: string }) {
    const parsed = zDashboardRef(input);
    const dashboard = await this.repository.tryFindDashboard(parsed);
    if (!dashboard) throw new DashboardNotFoundError();
    return dashboard;
  }

  async create(input: { projectId: string; name: string }) {
    const parsed = dashboardCreateInputSchema.parse(input);
    const last = await this.repository.tryFindLastDashboard({ projectId: parsed.projectId });
    return this.repository.createDashboard({
      id: this.ids.generate(),
      projectId: parsed.projectId,
      name: parsed.name,
      order: (last?.order ?? -1) + 1,
    });
  }

  async rename(input: { projectId: string; dashboardId: string; name: string }) {
    const parsed = dashboardRenameInputSchema.parse(input);
    await this.getById({ projectId: parsed.projectId, dashboardId: parsed.dashboardId });
    return this.repository.updateDashboard({
      projectId: parsed.projectId,
      dashboardId: parsed.dashboardId,
      data: { name: parsed.name },
    });
  }

  async delete(input: { projectId: string; dashboardId: string }) {
    const parsed = zDashboardRef(input);
    await this.getById(parsed);
    return this.repository.deleteDashboard(parsed);
  }

  async reorder(input: { projectId: string; dashboardIds: string[] }) {
    const parsed = dashboardReorderInputSchema.parse(input);
    const found = new Set(await this.repository.findDashboardIds(parsed));
    const missingIds = parsed.dashboardIds.filter((id) => !found.has(id));
    if (missingIds.length > 0) throw new DashboardReorderError(missingIds);
    await this.repository.updateDashboardOrder(parsed);
    return { success: true as const };
  }

  async getOrCreateFirst(input: { projectId: string }) {
    const projectId = zProjectId(input.projectId);
    const first = await this.repository.tryFindFirstDashboard({ projectId });
    if (first) return first;
    return this.repository.createDashboard({
      id: this.ids.generate(),
      projectId,
      name: "Reports",
      order: 0,
    });
  }

  async listGraphs(input: { projectId: string; dashboardId?: string }) {
    const projectId = zProjectId(input.projectId);
    const dashboardId = input.dashboardId === undefined
      ? undefined
      : dashboardIdSchema.parse(input.dashboardId);
    return this.repository.findAllGraphs({ projectId, dashboardId });
  }

  async getGraph(input: { projectId: string; graphId: string }) {
    const parsed = zGraphRef(input);
    const graph = await this.repository.tryFindGraph(parsed);
    if (!graph) throw new GraphNotFoundError();
    return graph;
  }

  async createGraph(input: {
    projectId: string;
    name: string;
    graph: Record<string, unknown>;
    filters?: Record<string, unknown>;
    dashboardId?: string;
    layout?: Partial<GraphLayout>;
  }) {
    const parsed = graphCreateInputSchema.parse({
      ...input,
      ...input.layout,
    });
    if (parsed.dashboardId !== undefined) {
      await this.getById({ projectId: parsed.projectId, dashboardId: parsed.dashboardId });
    }
    const lastGridRow = parsed.dashboardId === undefined
      ? null
      : await this.repository.tryFindLastGraphGridRow({ projectId: parsed.projectId, dashboardId: parsed.dashboardId });
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
  }) {
    const parsed = graphUpdateInputSchema.parse(input);
    await this.getGraph({ projectId: parsed.projectId, graphId: parsed.graphId });
    return this.repository.updateGraph({
      projectId: parsed.projectId,
      graphId: parsed.graphId,
      ...(parsed.name === undefined ? {} : { name: graphNameSchema.parse(parsed.name) }),
      ...(parsed.graph === undefined ? {} : { graph: graphPayloadSchema.parse(parsed.graph) }),
      ...(parsed.filters === undefined ? {} : { filters: graphFiltersSchema.parse(parsed.filters) }),
    });
  }

  async deleteGraph(input: { projectId: string; graphId: string }) {
    const parsed = zGraphRef(input);
    await this.getGraph(parsed);
    return this.repository.deleteGraph(parsed);
  }

  async updateGraphLayout(input: { projectId: string; graphId: string; layout: GraphLayout }) {
    const parsed = graphLayoutSchema.parse(input.layout);
    const ref = zGraphRef(input);
    await this.getGraph(ref);
    return this.repository.updateGraphLayout({ ...ref, layout: parsed });
  }

  async batchUpdateGraphLayouts(input: {
    projectId: string;
    layouts: Array<{ graphId: string; layout: GraphLayout }>;
  }) {
    const projectId = zProjectId(input.projectId);
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

  async listSavedWorkbenchCharts(input: { projectId: string }) {
    const rows = await this.repository.findAllSavedWorkbenchCharts({ projectId: zProjectId(input.projectId) });
    return rows.map((row) => this.presentSavedWorkbenchChart(row));
  }

  async getSavedWorkbenchChart(input: { projectId: string; chartId: string }) {
    const parsed = zSavedChartRef(input);
    const chart = await this.repository.tryFindSavedWorkbenchChart(parsed);
    if (!chart) throw new SavedWorkbenchChartNotFoundError();
    return this.presentSavedWorkbenchChart(chart);
  }

  async createSavedWorkbenchChart(input: {
    projectId: string;
    name: string;
    definition: SavedWorkbenchChartDefinition;
    id?: string;
  }) {
    const projectId = zProjectId(input.projectId);
    const name = savedWorkbenchChartNameSchema.parse(input.name);
    const definition = savedWorkbenchChartDefinitionSchema.parse(input.definition);
    this.savedWorkbenchChartPolicy.validate({ projectId, definition });
    const chart = await this.repository.createSavedWorkbenchChart({
      id: input.id === undefined ? this.ids.generate() : savedWorkbenchChartIdSchema.parse(input.id),
      projectId,
      name,
      definition,
    });
    return this.presentSavedWorkbenchChart(chart);
  }

  async updateSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    name?: string;
    definition?: SavedWorkbenchChartDefinition;
  }) {
    const parsed = zSavedChartRef(input);
    await this.getSavedWorkbenchChart(parsed);
    const name = input.name === undefined ? undefined : savedWorkbenchChartNameSchema.parse(input.name);
    const definition = input.definition === undefined ? undefined : savedWorkbenchChartDefinitionSchema.parse(input.definition);
    if (definition !== undefined) this.savedWorkbenchChartPolicy.validate({ projectId: parsed.projectId, definition });
    const chart = await this.repository.tryUpdateSavedWorkbenchChart({ ...parsed, name, definition });
    if (!chart) throw new SavedWorkbenchChartNotFoundError();
    return this.presentSavedWorkbenchChart(chart);
  }

  async deleteSavedWorkbenchChart(input: { projectId: string; chartId: string }): Promise<void> {
    const parsed = zSavedChartRef(input);
    const count = await this.repository.deleteSavedWorkbenchChart(parsed);
    if (count === 0) throw new SavedWorkbenchChartNotFoundError();
  }

  private presentSavedWorkbenchChart<T extends { id: string; definition: unknown }>(
    row: T,
  ): T & { definition: SavedWorkbenchChartDefinition } {
    const parsed = savedWorkbenchChartDefinitionSchema.safeParse(row.definition);
    if (!parsed.success) {
      throw new SavedWorkbenchChartDefinitionInvalidError(row.id);
    }
    return { ...row, definition: parsed.data };
  }
}

const zProjectId = (projectId: string): string => projectIdSchema.parse(projectId);

const zDashboardRef = (input: { projectId: string; dashboardId: string }) => ({
  projectId: zProjectId(input.projectId),
  dashboardId: dashboardIdSchema.parse(input.dashboardId),
});

const zGraphRef = (input: { projectId: string; graphId: string }) => ({
  projectId: zProjectId(input.projectId),
  graphId: graphIdSchema.parse(input.graphId),
});

const zSavedChartRef = (input: { projectId: string; chartId: string }) => ({
  projectId: zProjectId(input.projectId),
  chartId: savedWorkbenchChartIdSchema.parse(input.chartId),
});
