import { DASHBOARD_SRCDOC_CHART_KIND } from "@langwatch/analytics-contract";
import { chartGridBottomRow } from "@langwatch/analytics-contract/chart-grid";
import {
  dashboardSchema,
  graphFiltersSchema,
  graphPayloadSchema,
  graphSchema,
  savedWorkbenchChartDefinitionSchema,
  savedWorkbenchChartSchema,
  SavedWorkbenchChartAlreadyExistsError,
  SavedWorkbenchChartNotFoundError,
  type DashboardViewer,
  type GraphLayout,
  type SavedWorkbenchChartDefinition,
  type DashboardUsageCount,
} from "@langwatch/dashboard-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import type { Prisma } from "@langwatch/prisma-client/generated";

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

const BUILDER_CHART_KIND = "builder";
const WORKBENCH_SQL_CHART_KIND = "workbench_sql";

/** A Reports chart: any kind but the stale srcdoc copies of Dashboards widgets. */
const REPORTS_CHART = {
  kind: { not: DASHBOARD_SRCDOC_CHART_KIND },
} satisfies Prisma.CustomGraphWhereInput;

/** An Only me row is its author's alone, so a project credential sees none (AC199m). */
const boardSeenBy = (viewer: DashboardViewer | undefined): Prisma.DashboardWhereInput =>
  viewer === undefined
    ? { scope: { not: "PRIVATE" } }
    : { OR: [{ scope: { not: "PRIVATE" } }, { createdById: viewer.userId }] };

/** A chart on no board, or on a board the reader sees. */
const chartSeenBy = (viewer: DashboardViewer | undefined): Prisma.CustomGraphWhereInput => ({
  OR: [{ dashboardId: null }, { dashboard: boardSeenBy(viewer) }],
});

const dashboardRow = (row: {
  id: string;
  projectId: string;
  name: string;
  order: number;
  description: string | null;
  createdById: string | null;
  scope: string;
  organizationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): DashboardRecord =>
  dashboardSchema.parse({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    order: row.order,
    description: row.description,
    createdById: row.createdById,
    scope: row.scope,
    organizationId: row.organizationId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

type StoredGraph = {
  id: string;
  projectId: string;
  name: string;
  graph: unknown;
  filters: unknown;
  dashboardId: string | null;
  gridColumn: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
  createdAt: Date;
  updatedAt: Date;
};

const graphRow = (row: StoredGraph): GraphRecord =>
  graphSchema.parse({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    graph: graphPayloadSchema.parse(row.graph),
    filters: row.filters ? graphFiltersSchema.parse(row.filters) : null,
    dashboardId: row.dashboardId,
    gridColumn: row.gridColumn,
    gridRow: row.gridRow,
    colSpan: row.colSpan,
    rowSpan: row.rowSpan,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

const savedWorkbenchChartRow = (row: StoredGraph): SavedWorkbenchChartRecord =>
  savedWorkbenchChartSchema.parse({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    definition: savedWorkbenchChartDefinitionSchema.parse(row.graph),
    dashboardId: row.dashboardId,
    gridColumn: row.gridColumn,
    gridRow: row.gridRow,
    colSpan: row.colSpan,
    rowSpan: row.rowSpan,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

export class PrismaDashboardRepository
  extends PrismaRepository.transactionalFor(
    "Dashboard",
    "CustomGraph",
    "DashboardsV2",
    "DashboardWidget",
  )
  implements DashboardRepository
{
  static readonly create = this.factory((prisma) => new PrismaDashboardRepository(prisma));

  async countUsage({
    projectIds,
  }: {
    projectIds: readonly string[];
  }): Promise<DashboardUsageCount> {
    const inScope = { projectId: { in: [...projectIds] } };
    const [builderCharts, reportsCharts, widgets] = await Promise.all([
      this.prisma.customGraph.count({ where: { ...inScope, kind: BUILDER_CHART_KIND } }),
      this.prisma.customGraph.count({ where: { ...inScope, ...REPORTS_CHART } }),
      this.prisma.dashboardWidget.count({ where: inScope }),
    ]);
    return { builderCharts, charts: reportsCharts + widgets };
  }

  /** Of these boards of one project, the ids only Dashboards holds. */
  async findDashboardsOnlyIds(input: {
    projectId: string;
    dashboardIds: readonly string[];
  }): Promise<string[]> {
    if (input.dashboardIds.length === 0) return [];
    const { projectId } = input;
    const copied = await this.prisma.dashboardsV2.findMany({
      where: { projectId, id: { in: [...input.dashboardIds] } },
      select: { id: true },
    });
    if (copied.length === 0) return [];
    const holding = await this.prisma.customGraph.findMany({
      where: { projectId, dashboardId: { in: copied.map((row) => row.id) }, ...REPORTS_CHART },
      distinct: ["dashboardId"],
      select: { dashboardId: true },
    });
    const kept = new Set(holding.map((row) => row.dashboardId));
    return copied.flatMap((row) => (kept.has(row.id) ? [] : [row.id]));
  }

  /** These rows of one project without the boards only Dashboards holds. */
  async #inReports<Row extends { id: string }>(projectId: string, rows: Row[]): Promise<Row[]> {
    const hidden = new Set(
      await this.findDashboardsOnlyIds({ projectId, dashboardIds: rows.map((row) => row.id) }),
    );
    return rows.filter((row) => !hidden.has(row.id));
  }

  async findAllDashboards(
    input: DashboardReach & { graphKinds: readonly DashboardGraphKind[] },
  ): Promise<DashboardSummaryRecord[]> {
    const rows = await this.#inReports(
      input.projectId,
      await this.prisma.dashboard.findMany({
        where: { projectId: input.projectId, ...boardSeenBy(input.viewer) },
        orderBy: [{ order: "asc" }, { name: "asc" }],
      }),
    );
    const dashboardIds = rows.map((row) => row.id);
    const counts =
      dashboardIds.length > 0
        ? await this.prisma.customGraph.groupBy({
            by: ["dashboardId"],
            where: {
              projectId: input.projectId,
              dashboardId: { in: dashboardIds },
              kind: { in: [...input.graphKinds] },
            },
            _count: { _all: true },
          })
        : [];
    const graphCounts = new Map(counts.map((count) => [count.dashboardId, count._count._all]));
    return rows.map((row) => ({
      ...dashboardRow(row),
      graphCount: graphCounts.get(row.id) ?? 0,
    }));
  }

  async findDashboard(
    input: DashboardReach & { dashboardId: string },
  ): Promise<(DashboardRecord & { graphs: GraphRecord[] }) | undefined> {
    const row = await this.prisma.dashboard.findFirst({
      where: { id: input.dashboardId, projectId: input.projectId, ...boardSeenBy(input.viewer) },
      include: {
        graphs: {
          where: { kind: BUILDER_CHART_KIND },
          orderBy: [{ gridRow: "asc" }, { gridColumn: "asc" }],
        },
      },
    });
    if (!row || (await this.#inReports(input.projectId, [row])).length === 0) return undefined;

    return { ...dashboardRow(row), graphs: row.graphs.map((graph) => graphRow(graph)) };
  }

  async findDashboards(
    input: DashboardReach & { dashboardIds: string[] },
  ): Promise<DashboardRecord[]> {
    const rows = await this.prisma.dashboard.findMany({
      where: {
        id: { in: input.dashboardIds },
        projectId: input.projectId,
        ...boardSeenBy(input.viewer),
      },
    });
    return (await this.#inReports(input.projectId, rows)).map((row) => dashboardRow(row));
  }

  async findLastDashboard(input: { projectId: string }): Promise<DashboardRecord | undefined> {
    const row = await this.prisma.dashboard.findFirst({
      where: { projectId: input.projectId },
      orderBy: { order: "desc" },
    });
    return row ? dashboardRow(row) : undefined;
  }

  async createDashboard(input: {
    id: string;
    projectId: string;
    name: string;
    order: number;
  }): Promise<DashboardRecord> {
    return dashboardRow(await this.prisma.dashboard.create({ data: input }));
  }

  async updateDashboard(input: {
    projectId: string;
    dashboardId: string;
    data: DashboardUpdate;
  }): Promise<DashboardRecord> {
    return dashboardRow(
      await this.prisma.dashboard.update({
        where: { id: input.dashboardId, projectId: input.projectId },
        data: input.data,
      }),
    );
  }

  async deleteDashboard(input: {
    projectId: string;
    dashboardId: string;
  }): Promise<DashboardRecord> {
    // Charts cascade by foreign key; the Dashboards area's rows are not this board's to touch.
    return dashboardRow(
      await this.prisma.dashboard.delete({
        where: { id: input.dashboardId, projectId: input.projectId },
      }),
    );
  }

  async updateDashboardOrder(input: { projectId: string; dashboardIds: string[] }): Promise<void> {
    // Writes only the rows whose position moved: a swap in a long list is two updates, not one
    // per dashboard, which kept a large project's reorder inside the transaction's time limit.
    await this.transaction(async (transaction) => {
      const current = await transaction.dashboard.findMany({
        where: { id: { in: input.dashboardIds }, projectId: input.projectId },
        select: { id: true, order: true },
      });
      const orderById = new Map(current.map((row) => [row.id, row.order]));
      await Promise.all(
        input.dashboardIds.flatMap((dashboardId, order) =>
          orderById.get(dashboardId) === order
            ? []
            : [
                transaction.dashboard.update({
                  where: { id: dashboardId, projectId: input.projectId },
                  data: { order },
                }),
              ],
        ),
      );
    });
  }

  async findAllGraphs(input: DashboardReach & { dashboardId?: string }): Promise<GraphRecord[]> {
    const rows = await this.prisma.customGraph.findMany({
      where: {
        projectId: input.projectId,
        kind: BUILDER_CHART_KIND,
        ...chartSeenBy(input.viewer),
        ...(input.dashboardId ? { dashboardId: input.dashboardId } : {}),
      },
      orderBy: input.dashboardId
        ? [{ gridRow: "asc" }, { gridColumn: "asc" }]
        : { createdAt: "desc" },
    });
    return rows.map((row) => graphRow(row));
  }

  async findGraph(input: DashboardReach & { graphId: string }): Promise<GraphRecord | undefined> {
    const row = await this.prisma.customGraph.findFirst({
      where: {
        id: input.graphId,
        projectId: input.projectId,
        kind: BUILDER_CHART_KIND,
        ...chartSeenBy(input.viewer),
      },
    });
    return row ? graphRow(row) : undefined;
  }

  async findNextFreeGridRow(input: { projectId: string; dashboardId: string }): Promise<number> {
    const cards = await this.prisma.customGraph.findMany({
      where: { projectId: input.projectId, dashboardId: input.dashboardId, ...REPORTS_CHART },
      select: { gridRow: true, rowSpan: true },
    });
    return chartGridBottomRow(cards);
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
    const row = await this.prisma.customGraph.create({
      data: {
        id: input.id,
        projectId: input.projectId,
        name: input.name,
        graph: input.graph as Prisma.InputJsonValue,
        filters: input.filters as Prisma.InputJsonValue,
        dashboardId: input.dashboardId,
        ...input.layout,
        kind: BUILDER_CHART_KIND,
      },
    });
    return graphRow(row);
  }

  async updateGraph(input: {
    projectId: string;
    graphId: string;
    name?: string;
    graph?: Record<string, unknown>;
    filters?: Record<string, unknown>;
  }): Promise<GraphRecord> {
    const row = await this.prisma.customGraph.update({
      where: { id: input.graphId, projectId: input.projectId, kind: BUILDER_CHART_KIND },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.graph === undefined ? {} : { graph: input.graph as Prisma.InputJsonValue }),
        ...(input.filters === undefined ? {} : { filters: input.filters as Prisma.InputJsonValue }),
      },
    });
    return graphRow(row);
  }

  async deleteGraph(input: { projectId: string; graphId: string }): Promise<GraphRecord> {
    const row = await this.prisma.customGraph.delete({
      where: { id: input.graphId, projectId: input.projectId, kind: BUILDER_CHART_KIND },
    });
    return graphRow(row);
  }

  async updateGraphLayout(input: {
    projectId: string;
    graphId: string;
    layout: GraphLayout;
  }): Promise<GraphRecord> {
    const row = await this.prisma.customGraph.update({
      where: { id: input.graphId, projectId: input.projectId, kind: BUILDER_CHART_KIND },
      data: input.layout,
    });
    return graphRow(row);
  }

  async updateGraphLayouts(input: {
    projectId: string;
    layouts: { graphId: string; layout: GraphLayout }[];
  }): Promise<void> {
    await this.transaction(async (transaction) => {
      for (const item of input.layouts) {
        await transaction.customGraph.update({
          where: { id: item.graphId, projectId: input.projectId, kind: BUILDER_CHART_KIND },
          data: item.layout,
        });
      }
    });
  }

  async findAllSavedWorkbenchCharts(input: DashboardReach): Promise<SavedWorkbenchChartRecord[]> {
    const rows = await this.prisma.customGraph.findMany({
      where: {
        projectId: input.projectId,
        kind: WORKBENCH_SQL_CHART_KIND,
        ...chartSeenBy(input.viewer),
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => savedWorkbenchChartRow(row));
  }

  async findSavedWorkbenchChart(
    input: DashboardReach & { chartId: string },
  ): Promise<SavedWorkbenchChartRecord | undefined> {
    const row = await this.prisma.customGraph.findFirst({
      where: {
        id: input.chartId,
        projectId: input.projectId,
        kind: WORKBENCH_SQL_CHART_KIND,
        ...chartSeenBy(input.viewer),
      },
    });
    return row ? savedWorkbenchChartRow(row) : undefined;
  }

  async createSavedWorkbenchChart(input: {
    id: string;
    projectId: string;
    name: string;
    definition: SavedWorkbenchChartDefinition;
  }): Promise<SavedWorkbenchChartRecord> {
    try {
      const row = await this.prisma.customGraph.create({
        data: {
          id: input.id,
          projectId: input.projectId,
          name: input.name,
          graph: input.definition as Prisma.InputJsonValue,
          kind: WORKBENCH_SQL_CHART_KIND,
        },
      });
      return savedWorkbenchChartRow(row);
    } catch (error) {
      if (isUniqueViolation(error)) throw new SavedWorkbenchChartAlreadyExistsError();
      throw error;
    }
  }

  async updateSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    name?: string;
    definition?: SavedWorkbenchChartDefinition;
  }): Promise<SavedWorkbenchChartRecord> {
    const rows = await this.prisma.customGraph.updateManyAndReturn({
      where: { id: input.chartId, projectId: input.projectId, kind: WORKBENCH_SQL_CHART_KIND },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.definition === undefined
          ? {}
          : { graph: input.definition as Prisma.InputJsonValue }),
      },
    });
    return savedWorkbenchChartRow(oneChart(rows));
  }

  async deleteSavedWorkbenchChart(input: { projectId: string; chartId: string }): Promise<void> {
    const result = await this.prisma.customGraph.deleteMany({
      where: { id: input.chartId, projectId: input.projectId, kind: WORKBENCH_SQL_CHART_KIND },
    });
    if (result.count === 0) throw new SavedWorkbenchChartNotFoundError();
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
    const rows = await this.prisma.customGraph.updateManyAndReturn({
      where: { id: input.chartId, projectId: input.projectId, kind: WORKBENCH_SQL_CHART_KIND },
      data: {
        dashboardId: input.dashboardId,
        gridColumn: input.gridColumn,
        gridRow: input.gridRow,
        colSpan: input.colSpan,
        rowSpan: input.rowSpan,
      },
    });
    return savedWorkbenchChartRow(oneChart(rows));
  }

  async unplaceSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
  }): Promise<SavedWorkbenchChartRecord> {
    const rows = await this.prisma.customGraph.updateManyAndReturn({
      where: { id: input.chartId, projectId: input.projectId, kind: WORKBENCH_SQL_CHART_KIND },
      data: { dashboardId: null, gridColumn: 0, gridRow: 0, colSpan: 1, rowSpan: 1 },
    });
    return savedWorkbenchChartRow(oneChart(rows));
  }
}

function oneChart(rows: readonly StoredGraph[]): StoredGraph {
  const row = rows[0];
  if (!row) throw new SavedWorkbenchChartNotFoundError();
  return row;
}

/** Prisma reports a unique-constraint violation as error code `P2002`. */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "P2002";
}
