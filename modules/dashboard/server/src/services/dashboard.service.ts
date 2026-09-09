import { generate } from "@langwatch/ksuid";
import {
  DASHBOARD_KSUID_RESOURCE,
  dashboardCreateInputSchema,
  dashboardIdSchema,
  dashboardRenameInputSchema,
  dashboardReorderInputSchema,
  DashboardNotFoundError,
  DashboardReorderUnknownIdsError,
  GRAPH_KSUID_RESOURCE,
  graphCreateInputSchema,
  graphFiltersSchema,
  graphIdSchema,
  graphLayoutSchema,
  graphNameSchema,
  graphPayloadSchema,
  GraphNotFoundError,
  graphUpdateInputSchema,
  projectIdSchema,
  type Dashboard,
  type DashboardGraphCountScope,
  type DashboardSummary,
  type Graph,
  type GraphLayout,
} from "@langwatch/dashboard-contract";
import type { WorkbenchAccessPort } from "../ports/workbench-access.port.ts";
import type {
  DashboardGraphKind,
  DashboardRepository,
} from "../repositories/dashboard.repository.ts";

const defaultLayout: GraphLayout = {
  gridColumn: 0,
  gridRow: 0,
  colSpan: 1,
  rowSpan: 1,
};

/** The project's dashboards and the chart-builder graphs placed on them. */
export class DashboardService {
  #repository: DashboardRepository;
  #workbenchAccess: WorkbenchAccessPort;

  private constructor(repository: DashboardRepository, workbenchAccess: WorkbenchAccessPort) {
    this.#repository = repository;
    this.#workbenchAccess = workbenchAccess;
  }

  static create(options: {
    repository: DashboardRepository;
    workbenchAccess: WorkbenchAccessPort;
  }): DashboardService {
    return new DashboardService(options.repository, options.workbenchAccess);
  }

  async getAll(input: {
    projectId: string;
    graphCountScope: DashboardGraphCountScope;
  }): Promise<DashboardSummary[]> {
    const projectId = projectIdSchema.parse(input.projectId);

    const graphKinds =
      input.graphCountScope === "builder"
        ? (["builder"] as const)
        : await this.#placeableKinds(projectId);

    return this.#repository.findAllDashboards({ projectId, graphKinds });
  }

  async getById(input: {
    projectId: string;
    dashboardId: string;
  }): Promise<Dashboard & { graphs: Graph[] }> {
    const parsed = dashboardRef(input);

    const dashboard = await this.#repository.findDashboard(parsed);
    if (!dashboard) throw new DashboardNotFoundError(parsed.projectId);

    return dashboard;
  }

  async create(input: { projectId: string; name: string }): Promise<Dashboard> {
    const parsed = dashboardCreateInputSchema.parse(input);

    const last = await this.#repository.findLastDashboard({ projectId: parsed.projectId });

    return this.#repository.createDashboard({
      id: generate(DASHBOARD_KSUID_RESOURCE).toString(),
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

    return this.#repository.updateDashboard({
      projectId: parsed.projectId,
      dashboardId: parsed.dashboardId,
      data: { name: parsed.name },
    });
  }

  async delete(input: { projectId: string; dashboardId: string }): Promise<Dashboard> {
    const parsed = dashboardRef(input);

    await this.getById(parsed);

    return this.#repository.deleteDashboard(parsed);
  }

  async reorder(input: { projectId: string; dashboardIds: string[] }): Promise<{ success: true }> {
    const parsed = dashboardReorderInputSchema.parse(input);

    const found = new Set(await this.#repository.findDashboardIds(parsed));

    const missingIds = parsed.dashboardIds.filter((id) => !found.has(id));
    if (missingIds.length > 0) throw new DashboardReorderUnknownIdsError(missingIds);

    await this.#repository.updateDashboardOrder(parsed);

    return { success: true as const };
  }

  async getOrCreateFirst(input: { projectId: string }): Promise<Dashboard> {
    const projectId = projectIdSchema.parse(input.projectId);

    const first = await this.#repository.findFirstDashboard({ projectId });
    if (first) return first;

    return this.#repository.createDashboard({
      id: generate(DASHBOARD_KSUID_RESOURCE).toString(),
      projectId,
      name: "Reports",
      order: 0,
    });
  }

  async listGraphs(input: { projectId: string; dashboardId?: string }): Promise<Graph[]> {
    const projectId = projectIdSchema.parse(input.projectId);

    const dashboardId =
      input.dashboardId === undefined ? undefined : dashboardIdSchema.parse(input.dashboardId);

    return this.#repository.findAllGraphs({ projectId, dashboardId });
  }

  async getGraph(input: { projectId: string; graphId: string }): Promise<Graph> {
    const parsed = graphRef(input);

    const graph = await this.#repository.findGraph(parsed);
    if (!graph) throw new GraphNotFoundError(parsed.projectId);

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
    // `layout` is this method's grouping, not a field of the create input: the
    // schema is strict and flattens the grid onto the row, so spreading
    // `input` whole would offer it the `layout` key it refuses.
    const { layout: requestedLayout, ...withoutLayout } = input;
    const parsed = graphCreateInputSchema.parse({ ...withoutLayout, ...requestedLayout });

    if (parsed.dashboardId !== undefined) {
      await this.getById({ projectId: parsed.projectId, dashboardId: parsed.dashboardId });
    }

    const lastGridRow =
      parsed.dashboardId === undefined
        ? undefined
        : await this.#repository.findLastGraphGridRow({
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

    return this.#repository.createGraph({
      id: generate(GRAPH_KSUID_RESOURCE).toString(),
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

    return this.#repository.updateGraph({
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
    const parsed = graphRef(input);

    await this.getGraph(parsed);

    return this.#repository.deleteGraph(parsed);
  }

  async updateGraphLayout(input: {
    projectId: string;
    graphId: string;
    layout: GraphLayout;
  }): Promise<Graph> {
    const layout = graphLayoutSchema.parse(input.layout);

    const ref = graphRef(input);

    await this.getGraph(ref);

    return this.#repository.updateGraphLayout({ ...ref, layout });
  }

  async batchUpdateGraphLayouts(input: {
    projectId: string;
    layouts: Array<{ graphId: string; layout: GraphLayout }>;
  }): Promise<{ success: true }> {
    const projectId = projectIdSchema.parse(input.projectId);

    const layouts = input.layouts.map((item) => ({
      graphId: graphIdSchema.parse(item.graphId),
      layout: graphLayoutSchema.parse(item.layout),
    }));

    for (const item of layouts) {
      await this.getGraph({ projectId, graphId: item.graphId });
    }

    await this.#repository.updateGraphLayouts({ projectId, layouts });

    return { success: true as const };
  }

  /**
   * Which chart kinds count as cards the grid will draw. A project that may
   * not place workbench cards counts only the builder's.
   */
  async #placeableKinds(projectId: string): Promise<readonly DashboardGraphKind[]> {
    const enabled = await this.#workbenchAccess.isWorkbenchEnabled({ projectId });
    return enabled ? ["builder", "workbench_sql"] : ["builder"];
  }
}

const dashboardRef = (input: { projectId: string; dashboardId: string }) => ({
  projectId: projectIdSchema.parse(input.projectId),
  dashboardId: dashboardIdSchema.parse(input.dashboardId),
});

const graphRef = (input: { projectId: string; graphId: string }) => ({
  projectId: projectIdSchema.parse(input.projectId),
  graphId: graphIdSchema.parse(input.graphId),
});
