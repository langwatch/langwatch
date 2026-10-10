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
  MY_DASHBOARD_NAME,
  newDashboardScope,
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
import type { DashboardAccessService } from "./dashboard-access.service.ts";

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
 * The project's dashboards and the chart-builder graphs placed on them. Who sees a board is its
 * scope's to say (dashboards-v2.feature AC170 to AC173); who may write one the reader sees is
 * the analytics permissions', asked at the door.
 */
export class DashboardService {
  #repository: DashboardRepository;
  #workbenchAccess: WorkbenchAccess;
  #access: DashboardAccessService;

  private constructor(options: {
    repository: DashboardRepository;
    workbenchAccess: WorkbenchAccess;
    access: DashboardAccessService;
  }) {
    this.#repository = options.repository;
    this.#workbenchAccess = options.workbenchAccess;
    this.#access = options.access;
  }

  static create(options: {
    repository: DashboardRepository;
    workbenchAccess: WorkbenchAccess;
    access: DashboardAccessService;
  }): DashboardService {
    return new DashboardService(options);
  }

  countUsage(input: { projectIds: readonly string[] }): Promise<DashboardUsageCount> {
    return this.#repository.countUsage(input);
  }

  /** The project's boards the viewer may see; `includeOrganization` adds the organization's. */
  async getAll(input: {
    projectId: string;
    graphCountScope: DashboardGraphCountScope;
    viewer?: DashboardViewer;
    includeOrganization?: boolean;
  }): Promise<DashboardSummary[]> {
    const projectId = projectIdSchema.parse(input.projectId);

    const graphKinds =
      input.graphCountScope === "builder"
        ? (["builder"] as const)
        : await this.#placeableKinds(projectId);

    const listed = await this.#access.listBoards({ projectId, viewer: input.viewer, graphKinds });
    const guests = input.includeOrganization === true ? listed.guests : [];
    const sharedProjectIds = [...new Set(guests.map((board) => board.projectId))];

    const [starred, owners] = await Promise.all([
      this.#starredIds({ projectId, viewer: input.viewer, sharedProjectIds }),
      this.#access.findProjects({ projectIds: sharedProjectIds }),
    ]);
    const ownerById = new Map(owners.map((owner) => [owner.id, owner]));

    return [...listed.home, ...guests].map((dashboard) => ({
      ...dashboard,
      isStarred: starred.has(dashboard.id),
      ownerProject:
        dashboard.projectId === projectId ? null : (ownerById.get(dashboard.projectId) ?? null),
    }));
  }

  /** One board the viewer may open here, the project's own or the organization's. */
  async getById(input: {
    projectId: string;
    dashboardId: string;
    viewer?: DashboardViewer;
  }): Promise<Dashboard & { graphs: Graph[] }> {
    const parsed = dashboardRef(input);

    const dashboard = await this.#access.findWithGraphs({ ...parsed, viewer: input.viewer });
    if (!dashboard) throw new DashboardNotFoundError(parsed.projectId);

    return dashboard;
  }

  /**
   * A new board after the last, at the scope Project. A member's own My dashboard alone starts
   * starred for them, and at Only me where Dashboards is switched on.
   */
  async create(input: {
    projectId: string;
    name: string;
    createdById?: string;
  }): Promise<Dashboard> {
    const { createdById, ...fields } = input;
    const parsed = dashboardCreateInputSchema.parse(fields);
    const id = generate(DASHBOARD_KSUID_RESOURCE).toString();

    const last = await this.#repository.findLastDashboard({ projectId: parsed.projectId });
    const dashboardsEnabled = await this.#access.isDashboardsEnabled({
      projectId: parsed.projectId,
    });

    const dashboard = await this.#repository.createDashboard({
      id,
      projectId: parsed.projectId,
      name: parsed.name,
      order: (last?.order ?? -1) + 1,
      createdById: createdById ?? null,
      scope: newDashboardScope({ name: parsed.name, createdById, dashboardsEnabled }),
    });
    // Stored as an ordinary star, so unstarring it later removes it for good.
    if (createdById !== undefined && parsed.name === MY_DASHBOARD_NAME) {
      await this.#repository.addStar({
        projectId: parsed.projectId,
        userId: createdById,
        star: { kind: "board", dashboardId: dashboard.id },
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
    await this.#access.getWritable({ ...ref, viewer: input.viewer });
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
    await this.#access.getWritable({ ...ref, viewer: input.viewer });

    return this.#repository.deleteDashboard(ref);
  }

  /**
   * Writes the legacy `order` column; the REST reorder endpoint is the only caller. A board the
   * viewer may not see counts as an unknown id.
   */
  async reorder(input: {
    projectId: string;
    dashboardIds: string[];
    viewer?: DashboardViewer;
  }): Promise<{ success: true }> {
    const { viewer, ...fields } = input;
    const parsed = dashboardReorderInputSchema.parse(fields);

    const hidden = await this.#access.findHiddenBoardIds({ projectId: parsed.projectId, viewer });
    const found = await this.#repository.findDashboards(parsed);
    const reachable = new Set(found.map(({ id }) => id).filter((id) => !hidden.has(id)));
    const missingIds = parsed.dashboardIds.filter((id) => !reachable.has(id));
    if (missingIds.length > 0) throw new DashboardReorderUnknownIdsError(missingIds);

    await this.#repository.updateDashboardOrder(parsed);

    return { success: true as const };
  }

  /**
   * The project's first board the viewer may see, or a new one after the last where the
   * project takes writes (ADR-177).
   */
  async getOrCreateFirst(input: {
    projectId: string;
    acceptsWrites: boolean;
    viewer?: DashboardViewer;
  }): Promise<Dashboard[]> {
    const projectId = projectIdSchema.parse(input.projectId);

    const boards = await this.#repository.findAllDashboards({ projectId, graphKinds: [] });
    const hidden = await this.#access.findHiddenBoardIds({ projectId, viewer: input.viewer });
    const first = boards.find(({ id }) => !hidden.has(id));
    if (first) {
      const { graphCount: _graphCount, ...dashboard } = first;
      return [dashboard];
    }
    if (!input.acceptsWrites) return [];

    const created = await this.create({
      projectId,
      name: "Reports",
      ...(input.viewer === undefined ? {} : { createdById: input.viewer.userId }),
    });

    return [created];
  }

  // -- graphs ----------------------------------------------------------------

  async listGraphs(input: {
    projectId: string;
    dashboardId?: string;
    viewer?: DashboardViewer;
  }): Promise<Graph[]> {
    const projectId = projectIdSchema.parse(input.projectId);
    const hidden = await this.#access.findHiddenBoardIds({ projectId, viewer: input.viewer });
    const graphs =
      input.dashboardId === undefined
        ? await this.#repository.findAllGraphs({ projectId })
        : await this.#repository.findAllGraphs({
            projectId,
            dashboardId: dashboardIdSchema.parse(input.dashboardId),
          });
    // A graph on another member's Only me board is not there for this viewer.
    return graphs.filter(({ dashboardId }) => dashboardId === null || !hidden.has(dashboardId));
  }

  async getGraph(input: {
    projectId: string;
    graphId: string;
    viewer?: DashboardViewer;
  }): Promise<Graph> {
    const parsed = graphRef(input);

    const graph = await this.#repository.findGraph(parsed);
    if (!graph) throw new GraphNotFoundError(parsed.projectId);
    const onBoard = graph.dashboardId;
    const hidden =
      onBoard !== null &&
      (await this.#access.isHidden({ ...parsed, dashboardId: onBoard, viewer: input.viewer }));
    if (hidden) throw new GraphNotFoundError(parsed.projectId);

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
      await this.#access.getWritable({
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

  async #starredIds(input: {
    projectId: string;
    viewer?: DashboardViewer;
    sharedProjectIds: readonly string[];
  }): Promise<ReadonlySet<string>> {
    if (input.viewer === undefined) return new Set();
    return new Set(
      await this.#repository.findStarredDashboardIds({
        projectId: input.projectId,
        userId: input.viewer.userId,
        sharedProjectIds: input.sharedProjectIds,
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
