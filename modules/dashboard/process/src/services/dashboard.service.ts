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
  dashboardDetailsUpdateSchema,
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
 * The project's dashboards, the chart-builder graphs placed on them, and each
 * member's starred boards. Every board is visible to and editable by everyone
 * in the project; the analytics permissions alone gate writes.
 */
export class DashboardService {
  #repository: DashboardRepository;
  #workbenchAccess: WorkbenchAccess;

  private constructor(repository: DashboardRepository, workbenchAccess: WorkbenchAccess) {
    this.#repository = repository;
    this.#workbenchAccess = workbenchAccess;
  }

  static create(options: {
    repository: DashboardRepository;
    workbenchAccess: WorkbenchAccess;
  }): DashboardService {
    return new DashboardService(options.repository, options.workbenchAccess);
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

    const [dashboards, starred] = await Promise.all([
      this.#repository.findAllDashboards({ projectId, graphKinds }),
      this.#starredIds({ projectId, viewer: input.viewer }),
    ]);

    return dashboards.map((dashboard) => ({ ...dashboard, isStarred: starred.has(dashboard.id) }));
  }

  async getById(input: {
    projectId: string;
    dashboardId: string;
    viewer?: DashboardViewer;
  }): Promise<Dashboard & { graphs: Graph[] }> {
    const parsed = dashboardRef(input);

    const dashboard = await this.#repository.findDashboard(parsed);
    if (!dashboard) throw new DashboardNotFoundError(parsed.projectId);

    return dashboard;
  }

  /** A member-created board is starred for that member; a project credential makes no star. */
  async create(input: {
    projectId: string;
    name: string;
    createdById?: string;
  }): Promise<Dashboard> {
    const { createdById, ...fields } = input;
    const parsed = dashboardCreateInputSchema.parse(fields);
    const id = generate(DASHBOARD_KSUID_RESOURCE).toString();

    const last = await this.#repository.findLastDashboard({ projectId: parsed.projectId });

    const dashboard = await this.#repository.createDashboard({
      id,
      projectId: parsed.projectId,
      name: parsed.name,
      order: (last?.order ?? -1) + 1,
      createdById: createdById ?? null,
    });

    if (createdById !== undefined) {
      await this.#repository.starDashboard({
        projectId: parsed.projectId,
        userId: createdById,
        dashboardId: dashboard.id,
      });
    }

    return dashboard;
  }

  async rename(input: {
    projectId: string;
    dashboardId: string;
    name: string;
    viewer?: DashboardViewer;
  }): Promise<Dashboard> {
    const { viewer: _viewer, ...fields } = input;
    const parsed = dashboardRenameInputSchema.parse(fields);

    return this.updateDetails({
      projectId: parsed.projectId,
      dashboardId: parsed.dashboardId,
      name: parsed.name,
    });
  }

  /** The inline name and description; an absent field is left as it is. */
  async updateDetails(input: {
    projectId: string;
    dashboardId: string;
    name?: string;
    description?: string | null;
    viewer?: DashboardViewer;
  }): Promise<Dashboard> {
    const ref = dashboardRef(input);
    await this.#requireBoard(ref);
    const details = dashboardDetailsUpdateSchema.parse({
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
    });

    return this.#repository.updateDashboard({
      ...ref,
      data: {
        ...details,
        // An emptied description is no description, not an empty paragraph.
        ...(details.description === "" ? { description: null } : {}),
      },
    });
  }

  async delete(input: {
    projectId: string;
    dashboardId: string;
    viewer?: DashboardViewer;
  }): Promise<Dashboard> {
    const ref = dashboardRef(input);
    await this.#requireBoard(ref);

    return this.#repository.deleteDashboard(ref);
  }

  /** Writes the legacy `order` column; the REST reorder endpoint is the only caller. */
  async reorder(input: {
    projectId: string;
    dashboardIds: string[];
    viewer?: DashboardViewer;
  }): Promise<{ success: true }> {
    const { viewer: _viewer, ...fields } = input;
    const parsed = dashboardReorderInputSchema.parse(fields);

    const found = await this.#repository.findDashboardIds({
      projectId: parsed.projectId,
      dashboardIds: parsed.dashboardIds,
    });
    const reachable = new Set(found);
    const missingIds = parsed.dashboardIds.filter((id) => !reachable.has(id));
    if (missingIds.length > 0) throw new DashboardReorderUnknownIdsError(missingIds);

    await this.#repository.updateDashboardOrder(parsed);

    return { success: true as const };
  }

  /** The project's first board, or a new one after the last, starred for the viewer. */
  async getOrCreateFirst(input: {
    projectId: string;
    viewer?: DashboardViewer;
  }): Promise<Dashboard> {
    const projectId = projectIdSchema.parse(input.projectId);

    const first = await this.#repository.findFirstDashboard({ projectId });
    if (first) return first;

    return this.create({
      projectId,
      name: "Reports",
      ...(input.viewer === undefined ? {} : { createdById: input.viewer.userId }),
    });
  }

  // -- favourites ------------------------------------------------------------

  /** The member's starred boards for this project, in their own order. */
  async listStarred(input: { projectId: string; userId: string }): Promise<Dashboard[]> {
    const projectId = projectIdSchema.parse(input.projectId);
    return this.#repository.findStarredDashboards({ projectId, userId: input.userId });
  }

  async star(input: {
    projectId: string;
    userId: string;
    dashboardId: string;
  }): Promise<{ success: true }> {
    const ref = dashboardRef(input);
    await this.#requireBoard(ref);
    await this.#repository.starDashboard({ ...ref, userId: input.userId });
    return { success: true as const };
  }

  async unstar(input: {
    projectId: string;
    userId: string;
    dashboardId: string;
  }): Promise<{ success: true }> {
    const ref = dashboardRef(input);
    await this.#repository.unstarDashboard({ ...ref, userId: input.userId });
    return { success: true as const };
  }

  async reorderStars(input: {
    projectId: string;
    userId: string;
    dashboardIds: string[];
  }): Promise<{ success: true }> {
    const projectId = projectIdSchema.parse(input.projectId);
    await this.#repository.reorderStars({
      projectId,
      userId: input.userId,
      dashboardIds: input.dashboardIds.map((id) => dashboardIdSchema.parse(id)),
    });
    return { success: true as const };
  }

  /** Whether the project holds this board, for a peer placing a card on it. */
  async boardExists(input: { projectId: string; dashboardId: string }): Promise<boolean> {
    const ref = dashboardRef(input);
    const [found] = await this.#repository.findDashboardIds({
      projectId: ref.projectId,
      dashboardIds: [ref.dashboardId],
    });
    return found !== undefined;
  }

  // -- graphs ----------------------------------------------------------------

  async listGraphs(input: {
    projectId: string;
    dashboardId?: string;
    viewer?: DashboardViewer;
  }): Promise<Graph[]> {
    const projectId = projectIdSchema.parse(input.projectId);
    if (input.dashboardId !== undefined) {
      const dashboardId = dashboardIdSchema.parse(input.dashboardId);
      return this.#repository.findAllGraphs({ projectId, dashboardId });
    }
    return this.#repository.findAllGraphs({ projectId });
  }

  async getGraph(input: {
    projectId: string;
    graphId: string;
    viewer?: DashboardViewer;
  }): Promise<Graph> {
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
    viewer?: DashboardViewer;
  }): Promise<Graph> {
    // `layout` is this method's grouping, not a field of the create input: the
    // schema is strict and flattens the grid onto the row, so spreading
    // `input` whole would offer it the `layout` key it refuses.
    // An empty `dashboardId` places the graph on no dashboard, as main's `&&` did.
    const { layout: requestedLayout, viewer: _viewer, dashboardId, ...withoutLayout } = input;
    const parsed = graphCreateInputSchema.parse({
      ...withoutLayout,
      ...requestedLayout,
      ...(dashboardId ? { dashboardId } : {}),
    });

    if (parsed.dashboardId !== undefined) {
      await this.#requireBoard({ projectId: parsed.projectId, dashboardId: parsed.dashboardId });
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
    const { viewer: _viewer, ...fields } = input;
    const parsed = graphUpdateInputSchema.parse(fields);

    await this.getGraph({ projectId: parsed.projectId, graphId: parsed.graphId });

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

    await this.getGraph(parsed);

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

    await this.getGraph(ref);

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
      await this.getGraph({ projectId, graphId: item.graphId });
    }

    await this.#repository.updateGraphLayouts({ projectId, layouts });

    return { success: true as const };
  }

  /** Raises the feature's own absence when the project holds no such board. */
  async #requireBoard(ref: { projectId: string; dashboardId: string }): Promise<void> {
    const [found] = await this.#repository.findDashboardIds({
      projectId: ref.projectId,
      dashboardIds: [ref.dashboardId],
    });
    if (found === undefined) throw new DashboardNotFoundError(ref.projectId);
  }

  async #starredIds(input: {
    projectId: string;
    viewer?: DashboardViewer;
  }): Promise<ReadonlySet<string>> {
    if (input.viewer === undefined) return new Set();
    return new Set(
      await this.#repository.findStarredDashboardIds({
        projectId: input.projectId,
        userId: input.viewer.userId,
      }),
    );
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
