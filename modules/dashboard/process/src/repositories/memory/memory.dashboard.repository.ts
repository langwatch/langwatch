import { chartGridBottomRow } from "@langwatch/analytics-contract/chart-grid";
import {
  dashboardSchema,
  graphSchema,
  savedWorkbenchChartSchema,
  SavedWorkbenchChartAlreadyExistsError,
  SavedWorkbenchChartNotFoundError,
  type GraphLayout,
  type SavedWorkbenchChartDefinition,
  type DashboardScope,
  type DashboardStar,
  type DashboardUsageCount,
  type StarredDashboard,
} from "@langwatch/dashboard-contract";
import { Temporal, toDate } from "@langwatch/time";

import type {
  DashboardGraphKind,
  DashboardReach,
  DashboardRecord,
  DashboardRepository,
  DashboardSummaryRecord,
  DashboardUpdate,
  GraphRecord,
  MemberStars,
  SavedWorkbenchChartRecord,
} from "../dashboard.repository.ts";

/**
 * The one JSON column both chart kinds share: a builder graph payload, or a
 * saved workbench chart's definition as the contract names it.
 */
type StoredChartPayload = Record<string, unknown> | SavedWorkbenchChartDefinition;

/** One stored chart row, of either kind, as the shared table holds it. */
type StoredChart = Pick<GraphRecord, "createdAt" | "updatedAt"> & {
  id: string;
  projectId: string;
  name: string;
  kind: DashboardGraphKind;
  graph: StoredChartPayload;
  filters: Record<string, unknown> | null;
  dashboardId: string | null;
  gridColumn: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
};

/** One member's star on a board or a template, in their own order within a project. */
type StoredFavourite = {
  id: string;
  userId: string;
  dashboardId: string | null;
  templateId: string | null;
  projectId: string;
  position: number;
};

/** The same observable behaviour as the Prisma twin, over three arrays. */
export class MemoryDashboardRepository implements DashboardRepository {
  #dashboards: DashboardRecord[] = [];
  #charts: StoredChart[] = [];
  #favourites: StoredFavourite[] = [];
  #clock = 0;
  #favouriteId = 0;
  #archivedProjectIds: ReadonlySet<string>;

  private constructor(archivedProjectIds: ReadonlySet<string>) {
    this.#archivedProjectIds = archivedProjectIds;
  }

  /** The twin holds no project rows, so a test names the archived ones in a set it keeps. */
  static create(
    options: { archivedProjectIds?: ReadonlySet<string> } = {},
  ): MemoryDashboardRepository {
    return new MemoryDashboardRepository(options.archivedProjectIds ?? new Set());
  }

  async countUsage({
    projectIds,
  }: {
    projectIds: readonly string[];
  }): Promise<DashboardUsageCount> {
    const inScope = this.#charts.filter((chart) => projectIds.includes(chart.projectId));
    return {
      builderCharts: inScope.filter((chart) => chart.kind === "builder").length,
      charts: inScope.length,
    };
  }

  async findAllDashboards(
    input: DashboardReach & { graphKinds: readonly DashboardGraphKind[] },
  ): Promise<DashboardSummaryRecord[]> {
    const ordered = this.#dashboards
      .filter((dashboard) => this.#reaches(input, dashboard))
      .toSorted((left, right) => left.order - right.order || left.name.localeCompare(right.name));
    const isOwn = (dashboard: DashboardRecord) => dashboard.projectId === input.projectId;
    return [...ordered.filter(isOwn), ...ordered.filter((row) => !isOwn(row))].map((dashboard) => ({
      ...dashboard,
      graphCount: this.#charts.filter(
        (chart) => chart.dashboardId === dashboard.id && input.graphKinds.includes(chart.kind),
      ).length,
    }));
  }

  async findDashboard(
    input: DashboardReach & { dashboardId: string },
  ): Promise<(DashboardRecord & { graphs: GraphRecord[] }) | undefined> {
    const dashboard = this.#dashboards.find(
      (row) => row.id === input.dashboardId && this.#reaches(input, row),
    );
    if (!dashboard) return undefined;

    const graphs = this.#charts
      .filter((chart) => chart.kind === "builder" && chart.dashboardId === dashboard.id)
      .toSorted((left, right) => left.gridRow - right.gridRow || left.gridColumn - right.gridColumn)
      .map((chart) => graphOf(chart));

    return { ...dashboard, graphs };
  }

  async findDashboards(
    input: DashboardReach & { dashboardIds: string[] },
  ): Promise<DashboardRecord[]> {
    return this.#dashboards.filter(
      (dashboard) => input.dashboardIds.includes(dashboard.id) && this.#reaches(input, dashboard),
    );
  }

  async findLastDashboard(input: { projectId: string }): Promise<DashboardRecord | undefined> {
    return this.#dashboards
      .filter((dashboard) => dashboard.projectId === input.projectId)
      .toSorted((left, right) => right.order - left.order)[0];
  }

  async createDashboard(input: {
    id: string;
    projectId: string;
    name: string;
    order: number;
    createdById?: string | null;
    scope?: DashboardScope;
  }): Promise<DashboardRecord> {
    const dashboard = dashboardSchema.parse({
      ...input,
      description: null,
      createdById: input.createdById ?? null,
      scope: input.scope ?? "PROJECT",
      organizationId: null,
      createdAt: this.#now(),
      updatedAt: this.#now(),
    });
    this.#dashboards.push(dashboard);
    return dashboard;
  }

  async updateDashboard(input: {
    projectId: string;
    dashboardId: string;
    data: DashboardUpdate;
  }): Promise<DashboardRecord> {
    const dashboard = this.#requireDashboard(input);
    const updated = dashboardSchema.parse({
      ...dashboard,
      ...Object.fromEntries(Object.entries(input.data).filter(([, value]) => value !== undefined)),
      updatedAt: this.#now(),
    });
    this.#dashboards = this.#dashboards.map((row) => (row.id === dashboard.id ? updated : row));
    return updated;
  }

  async deleteDashboard(input: {
    projectId: string;
    dashboardId: string;
  }): Promise<DashboardRecord> {
    const dashboard = this.#requireDashboard(input);
    this.#dashboards = this.#dashboards.filter((row) => row.id !== dashboard.id);
    // The stored foreign key cascades, as the schema's does.
    this.#charts = this.#charts.filter((chart) => chart.dashboardId !== dashboard.id);
    // Favourites have no foreign key, so the delete removes them itself.
    this.#favourites = this.#favourites.filter((row) => row.dashboardId !== dashboard.id);
    return dashboard;
  }

  async findStarred(input: MemberStars): Promise<StarredDashboard[]> {
    return this.#starred(input).flatMap((favourite): StarredDashboard[] => {
      if (favourite.templateId !== null) {
        return [{ kind: "template", templateId: favourite.templateId }];
      }
      const dashboard = this.#dashboards.find((row) => row.id === favourite.dashboardId);
      return dashboard ? [{ kind: "board", dashboard }] : [];
    });
  }

  async findStarredDashboardIds(input: MemberStars): Promise<string[]> {
    return this.#starred(input).flatMap((favourite) =>
      favourite.dashboardId === null ? [] : [favourite.dashboardId],
    );
  }

  async addStar(input: {
    projectId: string;
    userId: string;
    star: DashboardStar;
    listedInProjectId?: string;
  }): Promise<void> {
    if (this.#favourite(input)) return;
    const listedIn = [input.projectId, input.listedInProjectId ?? input.projectId];
    const positions = this.#favourites
      .filter((row) => row.userId === input.userId && listedIn.includes(row.projectId))
      .map((row) => row.position);
    this.#favouriteId += 1;
    this.#favourites.push({
      id: `fav_${this.#favouriteId}`,
      userId: input.userId,
      projectId: input.projectId,
      dashboardId: input.star.kind === "board" ? input.star.dashboardId : null,
      templateId: input.star.kind === "template" ? input.star.templateId : null,
      position: Math.max(-1, ...positions) + 1,
    });
  }

  async removeStar(input: {
    projectId: string;
    userId: string;
    star: DashboardStar;
  }): Promise<void> {
    const found = this.#favourite(input);
    this.#favourites = this.#favourites.filter((row) => row !== found);
  }

  async reorderStars(input: MemberStars & { stars: DashboardStar[] }): Promise<void> {
    for (const [position, star] of input.stars.entries()) {
      const favourite = this.#favourite({ ...input, star });
      if (favourite) favourite.position = position;
    }
  }

  async countOtherStars(input: {
    projectId: string;
    dashboardId: string;
    userId: string;
  }): Promise<number> {
    return this.#favourites.filter(
      (row) =>
        row.projectId === input.projectId &&
        row.dashboardId === input.dashboardId &&
        row.userId !== input.userId,
    ).length;
  }

  /** Whether a read from this project, and its organization when named, reaches the board. */
  #reaches(reach: DashboardReach, dashboard: DashboardRecord): boolean {
    if (dashboard.projectId === reach.projectId) return true;
    return (
      reach.organizationId !== undefined &&
      dashboard.scope === "ORGANIZATION" &&
      dashboard.organizationId === reach.organizationId &&
      !this.#archivedProjectIds.has(dashboard.projectId)
    );
  }

  /** The member's favourites as this project lists them, in position order. */
  #starred(input: MemberStars): StoredFavourite[] {
    const shared = (input.sharedProjectIds ?? []).filter(
      (projectId) => !this.#archivedProjectIds.has(projectId),
    );
    return this.#favourites
      .filter(
        (row) =>
          row.userId === input.userId &&
          (row.projectId === input.projectId ||
            (row.dashboardId !== null && shared.includes(row.projectId))),
      )
      .toSorted((left, right) => left.position - right.position);
  }

  #favourite(input: MemberStars & { star: DashboardStar }): StoredFavourite | undefined {
    return this.#starred(input).find((row) =>
      input.star.kind === "board"
        ? row.dashboardId === input.star.dashboardId
        : row.templateId === input.star.templateId,
    );
  }

  async updateDashboardOrder(input: { projectId: string; dashboardIds: string[] }): Promise<void> {
    for (const [order, dashboardId] of input.dashboardIds.entries()) {
      const dashboard = this.#requireDashboard({ projectId: input.projectId, dashboardId });
      this.#dashboards = this.#dashboards.map((row) =>
        row.id === dashboard.id ? { ...row, order, updatedAt: this.#now() } : row,
      );
    }
  }

  async findAllGraphs(input: { projectId: string; dashboardId?: string }): Promise<GraphRecord[]> {
    const rows = this.#charts.filter(
      (chart) =>
        chart.projectId === input.projectId &&
        chart.kind === "builder" &&
        (input.dashboardId === undefined || chart.dashboardId === input.dashboardId),
    );

    const ordered =
      input.dashboardId === undefined
        ? rows.toSorted((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        : rows.toSorted(
            (left, right) => left.gridRow - right.gridRow || left.gridColumn - right.gridColumn,
          );

    return ordered.map((chart) => graphOf(chart));
  }

  async findGraph(input: { projectId: string; graphId: string }): Promise<GraphRecord | undefined> {
    const chart = this.#chart(input.projectId, input.graphId, "builder");
    return chart ? graphOf(chart) : undefined;
  }

  async findNextFreeGridRow(input: { projectId: string; dashboardId: string }): Promise<number> {
    return chartGridBottomRow(
      this.#charts.filter(
        (chart) => chart.projectId === input.projectId && chart.dashboardId === input.dashboardId,
      ),
    );
  }

  async createGraph(input: {
    id: string;
    projectId: string;
    name: string;
    graph: Record<string, unknown>;
    filters: Record<string, unknown>;
    dashboardId: string | null;
    layout: GraphLayout;
  }): Promise<GraphRecord> {
    const chart: StoredChart = {
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      kind: "builder",
      graph: input.graph,
      filters: input.filters,
      dashboardId: input.dashboardId,
      ...input.layout,
      createdAt: this.#now(),
      updatedAt: this.#now(),
    };
    this.#charts.push(chart);
    return graphOf(chart);
  }

  async updateGraph(input: {
    projectId: string;
    graphId: string;
    name?: string;
    graph?: Record<string, unknown>;
    filters?: Record<string, unknown>;
  }): Promise<GraphRecord> {
    return graphOf(
      this.#replaceChart(this.#requireChart(input.projectId, input.graphId, "builder"), {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.graph === undefined ? {} : { graph: input.graph }),
        ...(input.filters === undefined ? {} : { filters: input.filters }),
      }),
    );
  }

  async deleteGraph(input: { projectId: string; graphId: string }): Promise<GraphRecord> {
    const chart = this.#requireChart(input.projectId, input.graphId, "builder");
    this.#charts = this.#charts.filter((row) => row.id !== chart.id);
    return graphOf(chart);
  }

  async updateGraphLayout(input: {
    projectId: string;
    graphId: string;
    layout: GraphLayout;
  }): Promise<GraphRecord> {
    return graphOf(
      this.#replaceChart(
        this.#requireChart(input.projectId, input.graphId, "builder"),
        input.layout,
      ),
    );
  }

  async updateGraphLayouts(input: {
    projectId: string;
    layouts: { graphId: string; layout: GraphLayout }[];
  }): Promise<void> {
    for (const item of input.layouts) {
      this.#replaceChart(this.#requireChart(input.projectId, item.graphId, "builder"), item.layout);
    }
  }

  async findAllSavedWorkbenchCharts(input: {
    projectId: string;
  }): Promise<SavedWorkbenchChartRecord[]> {
    return this.#charts
      .filter((chart) => chart.projectId === input.projectId && chart.kind === "workbench_sql")
      .toSorted((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((chart) => savedChartOf(chart));
  }

  async findSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
  }): Promise<SavedWorkbenchChartRecord | undefined> {
    const chart = this.#chart(input.projectId, input.chartId, "workbench_sql");
    return chart ? savedChartOf(chart) : undefined;
  }

  async createSavedWorkbenchChart(input: {
    id: string;
    projectId: string;
    name: string;
    definition: SavedWorkbenchChartDefinition;
  }): Promise<SavedWorkbenchChartRecord> {
    if (this.#charts.some((chart) => chart.id === input.id)) {
      throw new SavedWorkbenchChartAlreadyExistsError();
    }

    const chart: StoredChart = {
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      kind: "workbench_sql",
      graph: input.definition,
      filters: null,
      dashboardId: null,
      gridColumn: 0,
      gridRow: 0,
      colSpan: 1,
      rowSpan: 1,
      createdAt: this.#now(),
      updatedAt: this.#now(),
    };
    this.#charts.push(chart);
    return savedChartOf(chart);
  }

  async updateSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    name?: string;
    definition?: SavedWorkbenchChartDefinition;
  }): Promise<SavedWorkbenchChartRecord> {
    return savedChartOf(
      this.#replaceChart(this.#requireChart(input.projectId, input.chartId, "workbench_sql"), {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.definition === undefined ? {} : { graph: input.definition }),
      }),
    );
  }

  async deleteSavedWorkbenchChart(input: { projectId: string; chartId: string }): Promise<void> {
    const chart = this.#requireChart(input.projectId, input.chartId, "workbench_sql");
    this.#charts = this.#charts.filter((row) => row.id !== chart.id);
  }

  async placeSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    dashboardId: string;
    gridColumn: number;
    gridRow: number;
    colSpan: number;
    rowSpan: number;
  }): Promise<SavedWorkbenchChartRecord> {
    return savedChartOf(
      this.#replaceChart(this.#requireChart(input.projectId, input.chartId, "workbench_sql"), {
        dashboardId: input.dashboardId,
        gridColumn: input.gridColumn,
        gridRow: input.gridRow,
        colSpan: input.colSpan,
        rowSpan: input.rowSpan,
      }),
    );
  }

  async unplaceSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
  }): Promise<SavedWorkbenchChartRecord> {
    return savedChartOf(
      this.#replaceChart(this.#requireChart(input.projectId, input.chartId, "workbench_sql"), {
        dashboardId: null,
        gridColumn: 0,
        gridRow: 0,
        colSpan: 1,
        rowSpan: 1,
      }),
    );
  }

  #dashboard(input: { projectId: string; dashboardId: string }): DashboardRecord | undefined {
    return this.#dashboards.find(
      (dashboard) => dashboard.id === input.dashboardId && dashboard.projectId === input.projectId,
    );
  }

  /** The Prisma twin's `update`/`delete` refuse an unmatched row; this does too. */
  #requireDashboard(input: { projectId: string; dashboardId: string }): DashboardRecord {
    const dashboard = this.#dashboard(input);
    if (!dashboard) throw new Error("Dashboard row not found");
    return dashboard;
  }

  #chart(projectId: string, id: string, kind: DashboardGraphKind): StoredChart | undefined {
    return this.#charts.find(
      (chart) => chart.id === id && chart.projectId === projectId && chart.kind === kind,
    );
  }

  #requireChart(projectId: string, id: string, kind: DashboardGraphKind): StoredChart {
    const chart = this.#chart(projectId, id, kind);
    if (chart) return chart;
    if (kind === "workbench_sql") throw new SavedWorkbenchChartNotFoundError();
    throw new Error("Graph row not found");
  }

  #replaceChart(chart: StoredChart, changes: Partial<StoredChart>): StoredChart {
    const updated = { ...chart, ...changes, updatedAt: this.#now() };
    this.#charts = this.#charts.map((row) => (row.id === chart.id ? updated : row));
    return updated;
  }

  /** A monotonic clock, so "the newest row" is the one written last. */
  #now(): GraphRecord["createdAt"] {
    this.#clock += 1;
    return toDate(Temporal.Instant.fromEpochMilliseconds(this.#clock));
  }
}

const graphOf = (chart: StoredChart): GraphRecord =>
  graphSchema.parse({
    id: chart.id,
    projectId: chart.projectId,
    name: chart.name,
    graph: chart.graph,
    filters: chart.filters,
    dashboardId: chart.dashboardId,
    gridColumn: chart.gridColumn,
    gridRow: chart.gridRow,
    colSpan: chart.colSpan,
    rowSpan: chart.rowSpan,
    createdAt: chart.createdAt,
    updatedAt: chart.updatedAt,
  });

const savedChartOf = (chart: StoredChart): SavedWorkbenchChartRecord =>
  savedWorkbenchChartSchema.parse({
    id: chart.id,
    projectId: chart.projectId,
    name: chart.name,
    definition: chart.graph,
    dashboardId: chart.dashboardId,
    gridColumn: chart.gridColumn,
    gridRow: chart.gridRow,
    colSpan: chart.colSpan,
    rowSpan: chart.rowSpan,
    createdAt: chart.createdAt,
    updatedAt: chart.updatedAt,
  });
