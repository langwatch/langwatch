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

import type { BoardRepository } from "../repositories/board.repository.ts";
import type {
  DashboardGraphKind,
  DashboardRepository,
} from "../repositories/dashboard.repository.ts";
import { listedArea } from "../rules/dashboard-board-area.rules.ts";
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
 * The Analytics Reports boards and their chart-builder graphs (`repository`, no scope: A8), and,
 * until board.service.ts takes them, the Dashboards area's board operations (`boards`). Who sees
 * a Dashboards board is its scope's to say (dashboards-v2.feature AC170 to AC173).
 */
export class DashboardService {
  #repository: DashboardRepository;
  #boards: BoardRepository;
  #workbenchAccess: WorkbenchAccess;
  #access: DashboardAccessService;

  private constructor(options: {
    repository: DashboardRepository;
    boards: BoardRepository;
    workbenchAccess: WorkbenchAccess;
    access: DashboardAccessService;
  }) {
    this.#repository = options.repository;
    this.#boards = options.boards;
    this.#workbenchAccess = options.workbenchAccess;
    this.#access = options.access;
  }

  static create(options: {
    repository: DashboardRepository;
    boards: BoardRepository;
    workbenchAccess: WorkbenchAccess;
    access: DashboardAccessService;
  }): DashboardService {
    return new DashboardService(options);
  }

  countUsage(input: { projectIds: readonly string[] }): Promise<DashboardUsageCount> {
    return this.#repository.countUsage(input);
  }

  /**
   * `excludeLegacy` lists the Dashboards area's boards the viewer may see, `includeOrganization`
   * adding the organization's; any other list is the Reports boards, which have no scope (A8).
   */
  async getAll(input: {
    projectId: string;
    graphCountScope: DashboardGraphCountScope;
    viewer?: DashboardViewer;
    includeOrganization?: boolean;
    excludeLegacy?: boolean;
    onlyLegacy?: boolean;
  }): Promise<DashboardSummary[]> {
    const projectId = projectIdSchema.parse(input.projectId);
    if (listedArea(input) !== "dashboards") {
      const graphKinds =
        input.graphCountScope === "builder"
          ? (["builder"] as const)
          : await this.#placeableKinds(projectId);
      const boards = await this.#repository.findAllDashboards({ projectId, graphKinds });
      return boards.map((board) => ({ ...board, isStarred: false, ownerProject: null }));
    }

    const listed = await this.#access.listBoards({ projectId, viewer: input.viewer });
    const guests = input.includeOrganization === true ? listed.guests : [];
    const sharedProjectIds = [...new Set(guests.map((board) => board.projectId))];
    // Every guest is a board of the reader's own organization.
    const organizationId = guests[0]?.organizationId ?? null;

    const [starred, owners] = await Promise.all([
      this.#starredIds({ projectId, viewer: input.viewer, sharedProjectIds }),
      this.#access.findProjects({
        organizationId,
        projectIds: sharedProjectIds,
        viewer: input.viewer,
      }),
    ]);
    const ownerById = new Map(owners.map((owner) => [owner.id, owner]));

    return [...listed.home, ...guests].map((dashboard) => ({
      ...dashboard,
      isStarred: starred.has(dashboard.id),
      ownerProject:
        dashboard.projectId === projectId ? null : (ownerById.get(dashboard.projectId) ?? null),
    }));
  }

  /**
   * The Reports board with its builder graphs, or else the Dashboards board the viewer may
   * open here, which holds no builder graph.
   */
  async getById(input: {
    projectId: string;
    dashboardId: string;
    viewer?: DashboardViewer;
  }): Promise<Dashboard & { graphs: Graph[] }> {
    const parsed = dashboardRef(input);

    const reports = await this.#repository.findDashboard(parsed);
    if (reports) return reports;
    const found = await this.#access.findReadable({ ...parsed, viewer: input.viewer });
    if (!found) throw new DashboardNotFoundError(parsed.projectId);

    return { ...found.board, graphs: [] };
  }

  /**
   * A Reports board after the last, at the scope Project and starred by nobody (AC199i). A
   * Dashboards board is made by board.service.ts's createBoard (pass 3a).
   */
  async create(input: {
    projectId: string;
    name: string;
    createdById?: string;
  }): Promise<Dashboard> {
    const { createdById: _createdById, ...fields } = input;
    const parsed = dashboardCreateInputSchema.parse(fields);
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
    if (await this.#inDashboards(parsed)) return this.updateDetails({ ...parsed, viewer });

    await this.#requireReportsBoard(parsed);
    return this.#repository.updateDashboard({
      projectId: parsed.projectId,
      dashboardId: parsed.dashboardId,
      data: { name: parsed.name },
    });
  }

  /** A Dashboards board's inline name and description; an absent field is left as it is. */
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

    return this.#boards.updateBoard({
      ...ref,
      data: {
        ...details,
        // An emptied description is no description, not an empty paragraph.
        ...(details.description === "" ? { description: null } : {}),
      },
    });
  }

  /**
   * With `cascadeLegacy`, which only Reports and REST send, the Reports board and its charts
   * (AC199d); without, the Dashboards board, its widgets and stars and its stale legacy copy,
   * leaving Reports charts and their alerts (AC199b).
   */
  async delete(input: {
    projectId: string;
    dashboardId: string;
    viewer?: DashboardViewer;
    cascadeLegacy?: boolean;
  }): Promise<Dashboard> {
    const ref = dashboardRef(input);
    if (input.cascadeLegacy === true) {
      await this.#requireReportsBoard(ref);
      return this.#repository.deleteDashboard(ref);
    }
    await this.#access.getWritable({ ...ref, viewer: input.viewer });

    return this.#boards.deleteBoard(ref);
  }

  /**
   * Writes the legacy `order` column; the REST reorder endpoint is the only caller. A board only
   * Dashboards holds counts as an unknown id.
   */
  async reorder(input: {
    projectId: string;
    dashboardIds: string[];
    viewer?: DashboardViewer;
  }): Promise<{ success: true }> {
    const { viewer: _viewer, ...fields } = input;
    const parsed = dashboardReorderInputSchema.parse(fields);

    const found = await this.#repository.findDashboards(parsed);
    const reachable = new Set(found.map(({ id }) => id));
    const missingIds = parsed.dashboardIds.filter((id) => !reachable.has(id));
    if (missingIds.length > 0) throw new DashboardReorderUnknownIdsError(missingIds);

    await this.#repository.updateDashboardOrder(parsed);

    return { success: true as const };
  }

  /** The project's first Reports board, or a new one where the project takes writes (ADR-177). */
  async getOrCreateFirst(input: {
    projectId: string;
    acceptsWrites: boolean;
    viewer?: DashboardViewer;
  }): Promise<Dashboard[]> {
    const projectId = projectIdSchema.parse(input.projectId);

    const [first] = await this.#repository.findAllDashboards({ projectId, graphKinds: [] });
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
    const projectId = projectIdSchema.parse(input.projectId);
    return input.dashboardId === undefined
      ? this.#repository.findAllGraphs({ projectId })
      : this.#repository.findAllGraphs({
          projectId,
          dashboardId: dashboardIdSchema.parse(input.dashboardId),
        });
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
      await this.#requireReportsBoard({
        projectId: parsed.projectId,
        dashboardId: parsed.dashboardId,
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
      await this.#boards.findStarredDashboardIds({
        projectId: input.projectId,
        userId: input.viewer.userId,
        sharedProjectIds: input.sharedProjectIds,
      }),
    );
  }

  /** Whether the Dashboards area holds this board, which decides which area a rename is for. */
  async #inDashboards(ref: { projectId: string; dashboardId: string }): Promise<boolean> {
    const found = await this.#boards.findBoardsByIds({
      projectId: ref.projectId,
      dashboardIds: [ref.dashboardId],
    });
    return found.length > 0;
  }

  /** The project's own Reports board; a board only Dashboards holds is absent (AC199j). */
  async #requireReportsBoard(ref: { projectId: string; dashboardId: string }): Promise<void> {
    const [board] = await this.#repository.findDashboards({
      projectId: ref.projectId,
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
