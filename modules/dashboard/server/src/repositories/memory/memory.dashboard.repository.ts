import {
  dashboardSchema,
  graphSchema,
  savedWorkbenchChartSchema,
  SavedWorkbenchChartAlreadyExistsError,
  SavedWorkbenchChartNotFoundError,
  type GraphLayout,
  type SavedWorkbenchChartDefinition,
} from "@langwatch/dashboard-contract";
import { Temporal, toDate } from "@langwatch/time";

import type {
  DashboardGraphKind,
  DashboardRecord,
  DashboardRepository,
  DashboardSummaryRecord,
  GraphRecord,
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

/** The same observable behaviour as the Prisma twin, over two arrays. */
export class MemoryDashboardRepository implements DashboardRepository {
  #dashboards: DashboardRecord[] = [];
  #charts: StoredChart[] = [];
  #clock = 0;

  private constructor() {}

  static create(): MemoryDashboardRepository {
    return new MemoryDashboardRepository();
  }

  async findAllDashboards(input: {
    projectId: string;
    graphKinds: readonly DashboardGraphKind[];
  }): Promise<DashboardSummaryRecord[]> {
    return this.#dashboards
      .filter((dashboard) => dashboard.projectId === input.projectId)
      .sort((left, right) => left.order - right.order)
      .map((dashboard) => ({
        ...dashboard,
        graphCount: this.#charts.filter(
          (chart) => chart.dashboardId === dashboard.id && input.graphKinds.includes(chart.kind),
        ).length,
      }));
  }

  async findDashboard(input: {
    projectId: string;
    dashboardId: string;
  }): Promise<(DashboardRecord & { graphs: GraphRecord[] }) | undefined> {
    const dashboard = this.#dashboard(input);
    if (!dashboard) return undefined;

    const graphs = this.#charts
      .filter((chart) => chart.kind === "builder" && chart.dashboardId === dashboard.id)
      .sort((left, right) => left.gridRow - right.gridRow || left.gridColumn - right.gridColumn)
      .map((chart) => graphOf(chart));

    return { ...dashboard, graphs };
  }

  async findFirstDashboard(input: { projectId: string }): Promise<DashboardRecord | undefined> {
    return this.#dashboards
      .filter((dashboard) => dashboard.projectId === input.projectId)
      .sort((left, right) => left.order - right.order)[0];
  }

  async findLastDashboard(input: { projectId: string }): Promise<DashboardRecord | undefined> {
    return this.#dashboards
      .filter((dashboard) => dashboard.projectId === input.projectId)
      .sort((left, right) => right.order - left.order)[0];
  }

  async findDashboardIds(input: { projectId: string; dashboardIds: string[] }): Promise<string[]> {
    return this.#dashboards
      .filter(
        (dashboard) =>
          dashboard.projectId === input.projectId && input.dashboardIds.includes(dashboard.id),
      )
      .map((dashboard) => dashboard.id);
  }

  async createDashboard(input: {
    id: string;
    projectId: string;
    name: string;
    order: number;
  }): Promise<DashboardRecord> {
    const dashboard = dashboardSchema.parse({
      ...input,
      createdAt: this.#now(),
      updatedAt: this.#now(),
    });
    this.#dashboards.push(dashboard);
    return dashboard;
  }

  async updateDashboard(input: {
    projectId: string;
    dashboardId: string;
    data: { name: string };
  }): Promise<DashboardRecord> {
    const dashboard = this.#requireDashboard(input);
    const updated = { ...dashboard, name: input.data.name, updatedAt: this.#now() };
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
    return dashboard;
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
        ? rows.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        : rows.sort(
            (left, right) => left.gridRow - right.gridRow || left.gridColumn - right.gridColumn,
          );

    return ordered.map((chart) => graphOf(chart));
  }

  async findGraph(input: { projectId: string; graphId: string }): Promise<GraphRecord | undefined> {
    const chart = this.#chart(input.projectId, input.graphId, "builder");
    return chart ? graphOf(chart) : undefined;
  }

  async findLastGraphGridRow(input: {
    projectId: string;
    dashboardId: string;
  }): Promise<number | undefined> {
    const rows = this.#charts
      .filter(
        (chart) => chart.projectId === input.projectId && chart.dashboardId === input.dashboardId,
      )
      .sort((left, right) => right.gridRow - left.gridRow);

    return rows[0]?.gridRow;
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
    layouts: Array<{ graphId: string; layout: GraphLayout }>;
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
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
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
