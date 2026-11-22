import {
  CHART_GRID_DEFAULT_COL_SPAN,
  CHART_GRID_DEFAULT_ROW_SPAN,
} from "@langwatch/analytics-contract/chart-grid";
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
  graphIdSchema,
  graphPlacementSchema,
  GraphNotFoundError,
  graphUpdateInputSchema,
  projectIdSchema,
  type Dashboard,
  type DashboardGraphCountScope,
  type DashboardSummary,
  type DashboardViewer,
  type Graph,
  type GraphLayout,
  type DashboardUsageCount,
} from "@langwatch/dashboard-contract";
import { generate } from "@langwatch/ksuid";

import type {
  DashboardGraphKind,
  DashboardRepository,
} from "../repositories/dashboard.repository.ts";

const defaultLayout: GraphLayout = {
  gridColumn: 0,
  gridRow: 0,
  colSpan: CHART_GRID_DEFAULT_COL_SPAN,
  rowSpan: CHART_GRID_DEFAULT_ROW_SPAN,
};

/**
 * Whether a project may place workbench cards at all: LangWatchQL's own gate,
 * a feature flag resolved against the project's organization, reached through Analytics.
 */
export interface WorkbenchAccess {
  isWorkbenchEnabled(input: { projectId: string }): Promise<boolean>;
}

/**
 * The Analytics Reports boards and their chart-builder graphs. Another member's Only me board and
 * its graphs read and write as absent (AC199m); so does a board only the Dashboards area holds
 * (dashboards-v2.feature AC199j). The Dashboards area's boards are BoardService's.
 */
export class DashboardService {
  #repository: DashboardRepository;
  #workbenchAccess: WorkbenchAccess;

  private constructor(options: {
    repository: DashboardRepository;
    workbenchAccess: WorkbenchAccess;
  }) {
    this.#repository = options.repository;
    this.#workbenchAccess = options.workbenchAccess;
  }

  static create(options: {
    repository: DashboardRepository;
    workbenchAccess: WorkbenchAccess;
  }): DashboardService {
    return new DashboardService(options);
  }

  countUsage(input: { projectIds: readonly string[] }): Promise<DashboardUsageCount> {
    return this.#repository.countUsage(input);
  }

  async getAll(input: {
    projectId: string;
    graphCountScope: DashboardGraphCountScope;
    viewer?: DashboardViewer;
  }): Promise<DashboardSummary[]> {
    const projectId = projectIdSchema.parse(input.projectId);
    const graphKinds =
      input.graphCountScope === "builder"
        ? (["builder"] as const)
        : await this.#placeableKinds(projectId);
    return this.#repository.findAllDashboards({ projectId, viewer: input.viewer, graphKinds });
  }

  async getById(input: {
    projectId: string;
    dashboardId: string;
    viewer?: DashboardViewer;
  }): Promise<Dashboard & { graphs: Graph[] }> {
    const parsed = dashboardRef(input);

    const found = await this.#repository.findDashboard({ ...parsed, viewer: input.viewer });
    if (!found) throw new DashboardNotFoundError(parsed.projectId);

    return found;
  }

  /** A board after the last, at the scope Project, with no author and no star (AC199i). */
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
    viewer?: DashboardViewer;
  }): Promise<Dashboard> {
    const { viewer, ...fields } = input;
    const parsed = dashboardRenameInputSchema.parse(fields);

    await this.#assertReportsBoard({ ...parsed, viewer });
    return this.#repository.updateDashboard({
      projectId: parsed.projectId,
      dashboardId: parsed.dashboardId,
      data: { name: parsed.name },
    });
  }

  /** The board and its charts; the Dashboards area's board under the same id stays (AC199d). */
  async delete(input: {
    projectId: string;
    dashboardId: string;
    viewer?: DashboardViewer;
  }): Promise<Dashboard> {
    const ref = dashboardRef(input);
    await this.#assertReportsBoard({ ...ref, viewer: input.viewer });
    return this.#repository.deleteDashboard(ref);
  }

  /** Writes the legacy `order` column; the REST reorder endpoint is the only caller. */
  async reorder(input: {
    projectId: string;
    dashboardIds: string[];
    viewer?: DashboardViewer;
  }): Promise<{ success: true }> {
    const { viewer, ...fields } = input;
    const parsed = dashboardReorderInputSchema.parse(fields);

    const found = await this.#repository.findDashboards({ ...parsed, viewer });
    const reachable = new Set(found.map(({ id }) => id));
    const missingIds = parsed.dashboardIds.filter((id) => !reachable.has(id));
    if (missingIds.length > 0) throw new DashboardReorderUnknownIdsError(missingIds);

    await this.#repository.updateDashboardOrder(parsed);

    return { success: true as const };
  }

  /** The project's first board, or a new one where the project takes writes (ADR-177). */
  async getOrCreateFirst(input: {
    projectId: string;
    acceptsWrites: boolean;
    viewer?: DashboardViewer;
  }): Promise<Dashboard[]> {
    const projectId = projectIdSchema.parse(input.projectId);

    const [first] = await this.#repository.findAllDashboards({
      projectId,
      viewer: input.viewer,
      graphKinds: [],
    });
    if (first) {
      const { graphCount: _graphCount, ...dashboard } = first;
      return [dashboard];
    }
    if (!input.acceptsWrites) return [];

    return [await this.create({ projectId, name: "Reports" })];
  }

  // -- graphs ----------------------------------------------------------------

  async listGraphs(input: {
    projectId: string;
    dashboardId?: string;
    viewer?: DashboardViewer;
  }): Promise<Graph[]> {
    const reach = { projectId: projectIdSchema.parse(input.projectId), viewer: input.viewer };
    return input.dashboardId === undefined
      ? this.#repository.findAllGraphs(reach)
      : this.#repository.findAllGraphs({
          ...reach,
          dashboardId: dashboardIdSchema.parse(input.dashboardId),
        });
  }

  async getGraph(input: {
    projectId: string;
    graphId: string;
    viewer?: DashboardViewer;
  }): Promise<Graph> {
    const parsed = graphRef(input);

    const graph = await this.#repository.findGraph({ ...parsed, viewer: input.viewer });
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
    viewer?: DashboardViewer;
  }): Promise<Graph> {
    // `layout` is this method's grouping, not a field of the create input: the
    // schema is strict and flattens the grid onto the row, so spreading
    // `input` whole would offer it the `layout` key it refuses.
    // An empty `dashboardId` places the graph on no dashboard, as main's `&&` did.
    const { layout: requestedLayout, viewer, dashboardId, ...withoutLayout } = input;
    const parsed = graphCreateInputSchema.parse({
      ...withoutLayout,
      ...requestedLayout,
      ...(dashboardId ? { dashboardId } : {}),
    });

    if (parsed.dashboardId !== undefined) {
      await this.#assertReportsBoard({
        projectId: parsed.projectId,
        dashboardId: parsed.dashboardId,
        viewer,
      });
    }

    const nextGridRow =
      requestedLayout?.gridRow === undefined && parsed.dashboardId !== undefined
        ? await this.#repository.findNextFreeGridRow({
            projectId: parsed.projectId,
            dashboardId: parsed.dashboardId,
          })
        : undefined;

    const layout = graphPlacementSchema.parse({
      ...defaultLayout,
      ...requestedLayout,
      ...(nextGridRow === undefined ? {} : { gridRow: nextGridRow }),
    });

    return this.#repository.createGraph({
      id: generate(GRAPH_KSUID_RESOURCE).toString(),
      projectId: parsed.projectId,
      name: parsed.name,
      graph: parsed.graph,
      filters: parsed.filters ?? {},
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
    viewer?: DashboardViewer;
  }): Promise<Graph> {
    const { viewer, ...fields } = input;
    const parsed = graphUpdateInputSchema.parse(fields);

    await this.getGraph({ projectId: parsed.projectId, graphId: parsed.graphId, viewer });

    return this.#repository.updateGraph({
      projectId: parsed.projectId,
      graphId: parsed.graphId,
      ...(parsed.name === undefined ? {} : { name: parsed.name }),
      ...(parsed.graph === undefined ? {} : { graph: parsed.graph }),
      ...(parsed.filters === undefined ? {} : { filters: parsed.filters }),
    });
  }

  async deleteGraph(input: {
    projectId: string;
    graphId: string;
    viewer?: DashboardViewer;
  }): Promise<Graph> {
    const parsed = graphRef(input);

    await this.getGraph({ ...parsed, viewer: input.viewer });

    return this.#repository.deleteGraph(parsed);
  }

  async updateGraphLayout(input: {
    projectId: string;
    graphId: string;
    layout: GraphLayout;
    viewer?: DashboardViewer;
  }): Promise<Graph> {
    const layout = graphPlacementSchema.parse(input.layout);

    const ref = graphRef(input);

    await this.getGraph({ ...ref, viewer: input.viewer });

    return this.#repository.updateGraphLayout({ ...ref, layout });
  }

  async batchUpdateGraphLayouts(input: {
    projectId: string;
    layouts: { graphId: string; layout: GraphLayout }[];
    viewer?: DashboardViewer;
  }): Promise<{ success: true }> {
    const projectId = projectIdSchema.parse(input.projectId);

    const layouts = input.layouts.map((item) => ({
      graphId: graphIdSchema.parse(item.graphId),
      layout: graphPlacementSchema.parse(item.layout),
    }));

    for (const item of layouts) {
      await this.getGraph({ projectId, graphId: item.graphId, viewer: input.viewer });
    }

    await this.#repository.updateGraphLayouts({ projectId, layouts });

    return { success: true as const };
  }

  /** A Reports board the viewer sees; one only Dashboards holds is absent (AC199j). */
  async #assertReportsBoard(ref: {
    projectId: string;
    dashboardId: string;
    viewer: DashboardViewer | undefined;
  }): Promise<void> {
    const [board] = await this.#repository.findDashboards({
      projectId: ref.projectId,
      viewer: ref.viewer,
      dashboardIds: [ref.dashboardId],
    });
    if (!board) throw new DashboardNotFoundError(ref.projectId);
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
