import { chartGridBottomRow } from "@langwatch/analytics-contract/chart-grid";
import {
  dashboardSchema,
  graphSchema,
  isDashboardAuthor,
  savedWorkbenchChartSchema,
  SavedWorkbenchChartAlreadyExistsError,
  SavedWorkbenchChartNotFoundError,
  type GraphLayout,
  type SavedWorkbenchChartDefinition,
  type DashboardUsageCount,
} from "@langwatch/dashboard-contract";

import type {
  DashboardGraphKind,
  DashboardReach,
  DashboardRecord,
  DashboardRepository,
  DashboardSummaryRecord,
  DashboardUpdate,
  GraphRecord,
  SavedWorkbenchChartRecord,
} from "../dashboard.repository.ts";
import { MemoryDashboardDatabase, type StoredChart } from "./memory.dashboard.database.ts";

/** A Reports chart: any kind but the stale srcdoc copies of Dashboards widgets. */
const isReportsChart = (chart: StoredChart) => chart.kind !== "dashboard_srcdoc";

/** An Only me row is its author's alone, so a project credential sees none (AC199m). */
const seenBy = (reach: DashboardReach, dashboard: DashboardRecord) =>
  dashboard.scope !== "PRIVATE" || isDashboardAuthor({ board: dashboard, viewer: reach.viewer });

/** The same observable behaviour as the Prisma twin, over the shared memory tables. */
export class MemoryDashboardRepository implements DashboardRepository {
  #database: MemoryDashboardDatabase;

  private constructor(database: MemoryDashboardDatabase) {
    this.#database = database;
  }

  /** `database` is shared with the module's other memory repositories; a fresh one otherwise. */
  static create(options: { database?: MemoryDashboardDatabase } = {}): MemoryDashboardRepository {
    return new MemoryDashboardRepository(options.database ?? MemoryDashboardDatabase.create());
  }

  get #dashboards(): DashboardRecord[] {
    return this.#database.dashboards;
  }

  set #dashboards(rows: DashboardRecord[]) {
    this.#database.dashboards = rows;
  }

  get #charts(): StoredChart[] {
    return this.#database.charts;
  }

  set #charts(rows: StoredChart[]) {
    this.#database.charts = rows;
  }

  async countUsage({
    projectIds,
  }: {
    projectIds: readonly string[];
  }): Promise<DashboardUsageCount> {
    const inScope = this.#charts.filter((chart) => projectIds.includes(chart.projectId));
    const widgets = this.#database.widgets.filter((widget) =>
      projectIds.includes(widget.projectId),
    );
    return {
      builderCharts: inScope.filter((chart) => chart.kind === "builder").length,
      charts: inScope.filter(isReportsChart).length + widgets.length,
    };
  }

  async findDashboardsOnlyIds(input: {
    projectId: string;
    dashboardIds: readonly string[];
  }): Promise<string[]> {
    return input.dashboardIds.filter((dashboardId) =>
      this.#database.isDashboardsOnly({ projectId: input.projectId, dashboardId }),
    );
  }

  async findAllDashboards(
    input: DashboardReach & { graphKinds: readonly DashboardGraphKind[] },
  ): Promise<DashboardSummaryRecord[]> {
    return this.#dashboards
      .filter((dashboard) => this.#reaches(input, dashboard))
      .toSorted((left, right) => left.order - right.order || left.name.localeCompare(right.name))
      .map((dashboard) => ({
        ...dashboard,
        graphCount: this.#charts.filter(
          (chart) =>
            chart.projectId === dashboard.projectId &&
            chart.dashboardId === dashboard.id &&
            (chart.kind === "builder" || chart.kind === "workbench_sql") &&
            input.graphKinds.includes(chart.kind),
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
  }): Promise<DashboardRecord> {
    const dashboard = dashboardSchema.parse({
      ...input,
      description: null,
      createdById: null,
      scope: "PROJECT",
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
    this.#dashboards = this.#dashboards.filter((row) => row !== dashboard);
    // The stored foreign key cascades, as the schema's does; the Dashboards area's rows stay.
    this.#charts = this.#charts.filter(
      (chart) => !(chart.projectId === dashboard.projectId && chart.dashboardId === dashboard.id),
    );
    return dashboard;
  }

  /** Whether a Reports read reaches the board: the project's own, seen by it, unless moved. */
  #reaches(reach: DashboardReach, dashboard: DashboardRecord): boolean {
    return (
      dashboard.projectId === reach.projectId &&
      seenBy(reach, dashboard) &&
      !this.#database.isDashboardsOnly({ projectId: reach.projectId, dashboardId: dashboard.id })
    );
  }

  /** A chart on no board, or on a board the reader sees, as the Prisma twin's relation filter. */
  #chartReaches(reach: DashboardReach, chart: StoredChart): boolean {
    if (chart.dashboardId === null) return true;
    const dashboard = this.#dashboard({
      projectId: chart.projectId,
      dashboardId: chart.dashboardId,
    });
    return dashboard !== undefined && seenBy(reach, dashboard);
  }

  async updateDashboardOrder(input: { projectId: string; dashboardIds: string[] }): Promise<void> {
    for (const [order, dashboardId] of input.dashboardIds.entries()) {
      const dashboard = this.#requireDashboard({ projectId: input.projectId, dashboardId });
      this.#dashboards = this.#dashboards.map((row) =>
        row.id === dashboard.id ? { ...row, order, updatedAt: this.#now() } : row,
      );
    }
  }

  async findAllGraphs(input: DashboardReach & { dashboardId?: string }): Promise<GraphRecord[]> {
    const rows = this.#charts.filter(
      (chart) =>
        chart.projectId === input.projectId &&
        chart.kind === "builder" &&
        this.#chartReaches(input, chart) &&
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

  async findGraph(input: DashboardReach & { graphId: string }): Promise<GraphRecord | undefined> {
    const chart = this.#chart(input.projectId, input.graphId, "builder");
    return chart && this.#chartReaches(input, chart) ? graphOf(chart) : undefined;
  }

  async findNextFreeGridRow(input: { projectId: string; dashboardId: string }): Promise<number> {
    return chartGridBottomRow(
      this.#charts.filter(
        (chart) =>
          chart.projectId === input.projectId &&
          chart.dashboardId === input.dashboardId &&
          isReportsChart(chart),
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

  async findAllSavedWorkbenchCharts(input: DashboardReach): Promise<SavedWorkbenchChartRecord[]> {
    return this.#charts
      .filter(
        (chart) =>
          chart.projectId === input.projectId &&
          chart.kind === "workbench_sql" &&
          this.#chartReaches(input, chart),
      )
      .toSorted((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((chart) => savedChartOf(chart));
  }

  async findSavedWorkbenchChart(
    input: DashboardReach & { chartId: string },
  ): Promise<SavedWorkbenchChartRecord | undefined> {
    const chart = this.#chart(input.projectId, input.chartId, "workbench_sql");
    return chart && this.#chartReaches(input, chart) ? savedChartOf(chart) : undefined;
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

  #now(): GraphRecord["createdAt"] {
    return this.#database.now();
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
