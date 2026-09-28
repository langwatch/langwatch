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
  DashboardOwnerOnlyError,
  DashboardReorderUnknownIdsError,
  dashboardDetailsUpdateSchema,
  dashboardVisibilitySchema,
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
  type DashboardVisibility,
  type Graph,
  type GraphLayout,
  type DashboardUsageCount,
} from "@langwatch/dashboard-contract";
import { generate } from "@langwatch/ksuid";

import type { DashboardAudience, WorkbenchAccess } from "../app/dashboard.members.ts";
import type {
  DashboardGraphKind,
  DashboardRepository,
} from "../repositories/dashboard.repository.ts";
import { refuseCodeDefinedDashboard } from "../rules/code-defined-dashboard.rules.ts";
import {
  isDashboardManageable,
  isDashboardVisible,
  needsTeamMembership,
} from "../rules/dashboard-visibility.rules.ts";

const defaultLayout: GraphLayout = {
  gridColumn: 0,
  gridRow: 0,
  colSpan: CHART_GRID_DEFAULT_COL_SPAN,
  rowSpan: CHART_GRID_DEFAULT_ROW_SPAN,
};

/** The project's dashboards and the chart-builder graphs placed on them. */
export class DashboardService {
  #repository: DashboardRepository;
  #workbenchAccess: WorkbenchAccess;
  #audience: DashboardAudience;

  private constructor(
    repository: DashboardRepository,
    workbenchAccess: WorkbenchAccess,
    audience: DashboardAudience,
  ) {
    this.#repository = repository;
    this.#workbenchAccess = workbenchAccess;
    this.#audience = audience;
  }

  static create(options: {
    repository: DashboardRepository;
    workbenchAccess: WorkbenchAccess;
    audience: DashboardAudience;
  }): DashboardService {
    return new DashboardService(options.repository, options.workbenchAccess, options.audience);
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

    const dashboards = await this.#repository.findAllDashboards({ projectId, graphKinds });

    return this.#visibleOnly({ projectId, viewer: input.viewer, dashboards });
  }

  /** Refuses as not found when the board is outside the viewer's audience. */
  async getById(input: {
    projectId: string;
    dashboardId: string;
    viewer?: DashboardViewer;
  }): Promise<Dashboard & { graphs: Graph[] }> {
    const parsed = dashboardRef(input);

    const dashboard = await this.#repository.findDashboard(parsed);
    if (!dashboard || !(await this.#isVisible({ ...parsed, viewer: input.viewer, dashboard }))) {
      throw new DashboardNotFoundError(parsed.projectId);
    }

    return dashboard;
  }

  async create(input: {
    projectId: string;
    name: string;
    createdById?: string;
  }): Promise<Dashboard> {
    const { createdById, ...fields } = input;
    const parsed = dashboardCreateInputSchema.parse(fields);

    const last = await this.#repository.findLastDashboard({ projectId: parsed.projectId });

    return this.#repository.createDashboard({
      id: generate(DASHBOARD_KSUID_RESOURCE).toString(),
      projectId: parsed.projectId,
      name: parsed.name,
      order: (last?.order ?? -1) + 1,
      createdById: createdById ?? null,
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

    return this.updateDetails({
      projectId: parsed.projectId,
      dashboardId: parsed.dashboardId,
      name: parsed.name,
      viewer,
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
    await this.#writable(input);
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

  async setVisibility(input: {
    projectId: string;
    dashboardId: string;
    visibility: DashboardVisibility;
    viewer?: DashboardViewer;
  }): Promise<Dashboard> {
    const visibility = dashboardVisibilitySchema.parse(input.visibility);
    const ref = dashboardRef(input);
    await this.#manageable(input);

    return this.#repository.updateDashboard({ ...ref, data: { visibility } });
  }

  async delete(input: {
    projectId: string;
    dashboardId: string;
    viewer?: DashboardViewer;
  }): Promise<Dashboard> {
    const ref = dashboardRef(input);
    await this.#manageable(input);

    return this.#repository.deleteDashboard(ref);
  }

  /** Boards outside the viewer's audience count as unknown ids. */
  async reorder(input: {
    projectId: string;
    dashboardIds: string[];
    viewer?: DashboardViewer;
  }): Promise<{ success: true }> {
    const { viewer, ...fields } = input;
    const parsed = dashboardReorderInputSchema.parse(fields);
    for (const dashboardId of parsed.dashboardIds) refuseCodeDefinedDashboard(dashboardId);

    const dashboards = await this.#repository.findAllDashboards({
      projectId: parsed.projectId,
      graphKinds: [],
    });
    const visible = await this.#visibleOnly({ projectId: parsed.projectId, viewer, dashboards });
    const reachable = new Set(visible.map((dashboard) => dashboard.id));

    const missingIds = parsed.dashboardIds.filter((id) => !reachable.has(id));
    if (missingIds.length > 0) throw new DashboardReorderUnknownIdsError(missingIds);

    await this.#repository.updateDashboardOrder(parsed);

    return { success: true as const };
  }

  /** The first board the viewer may see, or a new organisation-wide one after the last. */
  async getOrCreateFirst(input: {
    projectId: string;
    viewer?: DashboardViewer;
  }): Promise<Dashboard> {
    const projectId = projectIdSchema.parse(input.projectId);

    const dashboards = await this.#repository.findAllDashboards({ projectId, graphKinds: [] });
    const [first] = await this.#visibleOnly({ projectId, viewer: input.viewer, dashboards });
    if (first) {
      const { graphCount: _graphCount, ...dashboard } = first;
      return dashboard;
    }

    return this.#repository.createDashboard({
      id: generate(DASHBOARD_KSUID_RESOURCE).toString(),
      projectId,
      name: "Reports",
      order: (dashboards.at(-1)?.order ?? -1) + 1,
    });
  }

  /** Graphs on boards outside the viewer's audience are left out. */
  async listGraphs(input: {
    projectId: string;
    dashboardId?: string;
    viewer?: DashboardViewer;
  }): Promise<Graph[]> {
    const projectId = projectIdSchema.parse(input.projectId);

    if (input.dashboardId !== undefined) {
      const dashboardId = dashboardIdSchema.parse(input.dashboardId);
      const dashboard = await this.#repository.findDashboard({ projectId, dashboardId });
      if (dashboard && !(await this.#isVisible({ projectId, viewer: input.viewer, dashboard }))) {
        return [];
      }
      return this.#repository.findAllGraphs({ projectId, dashboardId });
    }

    const [graphs, dashboards] = await Promise.all([
      this.#repository.findAllGraphs({ projectId }),
      this.#repository.findAllDashboards({ projectId, graphKinds: [] }),
    ]);
    const visible = new Set(
      (await this.#visibleOnly({ projectId, viewer: input.viewer, dashboards })).map(
        (dashboard) => dashboard.id,
      ),
    );

    return graphs.filter((graph) => graph.dashboardId === null || visible.has(graph.dashboardId));
  }

  /** Refuses as not found when the graph sits on a board outside the viewer's audience. */
  async getGraph(input: {
    projectId: string;
    graphId: string;
    viewer?: DashboardViewer;
  }): Promise<Graph> {
    const parsed = graphRef(input);

    const graph = await this.#repository.findGraph(parsed);
    if (!graph) throw new GraphNotFoundError(parsed.projectId);
    if (graph.dashboardId !== null) {
      const dashboard = await this.#repository.findDashboard({
        projectId: parsed.projectId,
        dashboardId: graph.dashboardId,
      });
      const reachable =
        dashboard !== undefined &&
        (await this.#isVisible({ ...parsed, viewer: input.viewer, dashboard }));
      if (!reachable) throw new GraphNotFoundError(parsed.projectId);
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
    viewer?: DashboardViewer;
  }): Promise<Graph> {
    // `layout` is this method's grouping, not a field of the create input: the
    // schema is strict and flattens the grid onto the row, so spreading
    // `input` whole would offer it the `layout` key it refuses.
    const { layout: requestedLayout, viewer, ...withoutLayout } = input;
    const parsed = graphCreateInputSchema.parse({ ...withoutLayout, ...requestedLayout });

    if (parsed.dashboardId !== undefined) {
      await this.#writable({
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

    await this.getGraph({
      projectId: parsed.projectId,
      graphId: parsed.graphId,
      viewer,
    });

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

  /** The board once it is known writable: not code-defined, and visible to the viewer. */
  async #writable(input: {
    projectId: string;
    dashboardId: string;
    viewer?: DashboardViewer;
  }): Promise<Dashboard> {
    const ref = dashboardRef(input);
    refuseCodeDefinedDashboard(ref.dashboardId);

    return this.getById({ ...ref, viewer: input.viewer });
  }

  /** As {@link #writable}, and the viewer may change its visibility or delete it. */
  async #manageable(input: {
    projectId: string;
    dashboardId: string;
    viewer?: DashboardViewer;
  }): Promise<Dashboard> {
    const dashboard = await this.#writable(input);
    const { viewer } = input;

    if (isDashboardManageable({ dashboard, viewer, isAdmin: false })) return dashboard;
    const isAdmin =
      viewer !== undefined &&
      (await this.#audience.isAdmin({ projectId: dashboard.projectId, userId: viewer.userId }));
    if (isAdmin) return dashboard;

    throw new DashboardOwnerOnlyError(dashboard.id);
  }

  async #isVisible(input: {
    projectId: string;
    viewer: DashboardViewer | undefined;
    dashboard: Pick<Dashboard, "visibility" | "createdById">;
  }): Promise<boolean> {
    const [visible] = await this.#visibleOnly({
      projectId: input.projectId,
      viewer: input.viewer,
      dashboards: [input.dashboard],
    });
    return visible !== undefined;
  }

  /** Asks the team question at most once, and only when a team board depends on it. */
  async #visibleOnly<T extends Pick<Dashboard, "visibility" | "createdById">>(input: {
    projectId: string;
    viewer: DashboardViewer | undefined;
    dashboards: readonly T[];
  }): Promise<T[]> {
    const { projectId, viewer, dashboards } = input;
    const asksTeam = dashboards.some((dashboard) => needsTeamMembership({ dashboard, viewer }));
    const isTeamMember =
      asksTeam && viewer !== undefined
        ? await this.#audience.isTeamMember({ projectId, userId: viewer.userId })
        : false;

    return dashboards.filter((dashboard) =>
      isDashboardVisible({ dashboard, viewer, isTeamMember }),
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
