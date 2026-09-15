import {
  dashboardSchema,
  graphFiltersSchema,
  graphPayloadSchema,
  graphSchema,
  savedWorkbenchChartDefinitionSchema,
  savedWorkbenchChartSchema,
  SavedWorkbenchChartAlreadyExistsError,
  SavedWorkbenchChartNotFoundError,
  type GraphLayout,
  type SavedWorkbenchChartDefinition,
} from "@langwatch/dashboard-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import type { Prisma } from "@langwatch/prisma-client/generated";

import type {
  DashboardGraphKind,
  DashboardRecord,
  DashboardRepository,
  DashboardSummaryRecord,
  GraphRecord,
  SavedWorkbenchChartRecord,
} from "../dashboard.repository.ts";

const BUILDER_CHART_KIND = "builder";
const WORKBENCH_SQL_CHART_KIND = "workbench_sql";

const dashboardRow = (row: {
  id: string;
  projectId: string;
  name: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}): DashboardRecord =>
  dashboardSchema.parse({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    order: row.order,
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
  extends PrismaRepository.transactionalFor("Dashboard", "CustomGraph")
  implements DashboardRepository
{
  static readonly create = this.factory((prisma) => new PrismaDashboardRepository(prisma));

  async findAllDashboards(input: {
    projectId: string;
    graphKinds: readonly DashboardGraphKind[];
  }): Promise<DashboardSummaryRecord[]> {
    const rows = await this.prisma.dashboard.findMany({
      where: { projectId: input.projectId },
      orderBy: { order: "asc" },
      include: {
        _count: {
          select: {
            graphs: { where: { kind: { in: [...input.graphKinds] } } },
          },
        },
      },
    });
    return rows.map((row) => ({ ...dashboardRow(row), graphCount: row._count.graphs }));
  }

  async findDashboard(input: {
    projectId: string;
    dashboardId: string;
  }): Promise<(DashboardRecord & { graphs: GraphRecord[] }) | undefined> {
    const row = await this.prisma.dashboard.findFirst({
      where: { id: input.dashboardId, projectId: input.projectId },
      include: {
        graphs: {
          where: { kind: BUILDER_CHART_KIND },
          orderBy: [{ gridRow: "asc" }, { gridColumn: "asc" }],
        },
      },
    });
    if (!row) return undefined;

    return { ...dashboardRow(row), graphs: row.graphs.map((graph) => graphRow(graph)) };
  }

  async findFirstDashboard(input: { projectId: string }): Promise<DashboardRecord | undefined> {
    const row = await this.prisma.dashboard.findFirst({
      where: { projectId: input.projectId },
      orderBy: { order: "asc" },
    });
    return row ? dashboardRow(row) : undefined;
  }

  async findLastDashboard(input: { projectId: string }): Promise<DashboardRecord | undefined> {
    const row = await this.prisma.dashboard.findFirst({
      where: { projectId: input.projectId },
      orderBy: { order: "desc" },
    });
    return row ? dashboardRow(row) : undefined;
  }

  async findDashboardIds(input: { projectId: string; dashboardIds: string[] }): Promise<string[]> {
    const rows = await this.prisma.dashboard.findMany({
      where: { id: { in: input.dashboardIds }, projectId: input.projectId },
      select: { id: true },
    });
    return rows.map((row) => row.id);
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
    data: { name: string };
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
    return dashboardRow(
      await this.prisma.dashboard.delete({
        where: { id: input.dashboardId, projectId: input.projectId },
      }),
    );
  }

  async updateDashboardOrder(input: { projectId: string; dashboardIds: string[] }): Promise<void> {
    await this.transaction(async (transaction) => {
      for (const [order, dashboardId] of input.dashboardIds.entries()) {
        await transaction.dashboard.update({
          where: { id: dashboardId, projectId: input.projectId },
          data: { order },
        });
      }
    });
  }

  async findAllGraphs(input: { projectId: string; dashboardId?: string }): Promise<GraphRecord[]> {
    const rows = await this.prisma.customGraph.findMany({
      where: {
        projectId: input.projectId,
        kind: BUILDER_CHART_KIND,
        ...(input.dashboardId ? { dashboardId: input.dashboardId } : {}),
      },
      orderBy: input.dashboardId
        ? [{ gridRow: "asc" }, { gridColumn: "asc" }]
        : { createdAt: "desc" },
    });
    return rows.map((row) => graphRow(row));
  }

  async findGraph(input: { projectId: string; graphId: string }): Promise<GraphRecord | undefined> {
    const row = await this.prisma.customGraph.findFirst({
      where: { id: input.graphId, projectId: input.projectId, kind: BUILDER_CHART_KIND },
    });
    return row ? graphRow(row) : undefined;
  }

  async findLastGraphGridRow(input: {
    projectId: string;
    dashboardId: string;
  }): Promise<number | undefined> {
    const row = await this.prisma.customGraph.findFirst({
      where: { projectId: input.projectId, dashboardId: input.dashboardId },
      orderBy: { gridRow: "desc" },
      select: { gridRow: true },
    });
    return row?.gridRow ?? undefined;
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
    layouts: Array<{ graphId: string; layout: GraphLayout }>;
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

  async findAllSavedWorkbenchCharts(input: {
    projectId: string;
  }): Promise<SavedWorkbenchChartRecord[]> {
    const rows = await this.prisma.customGraph.findMany({
      where: { projectId: input.projectId, kind: WORKBENCH_SQL_CHART_KIND },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => savedWorkbenchChartRow(row));
  }

  async findSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
  }): Promise<SavedWorkbenchChartRecord | undefined> {
    const row = await this.prisma.customGraph.findFirst({
      where: { id: input.chartId, projectId: input.projectId, kind: WORKBENCH_SQL_CHART_KIND },
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
