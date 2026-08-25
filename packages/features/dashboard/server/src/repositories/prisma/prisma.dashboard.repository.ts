import type {
  Dashboard as PrismaDashboard,
  Prisma,
  PrismaClient,
} from "@langwatch/prisma-client/generated";
import {
  graphFiltersSchema,
  graphPayloadSchema,
  graphSchema,
  dashboardSchema,
  savedWorkbenchChartSchema,
  savedWorkbenchChartDefinitionSchema,
  type GraphLayout,
  type SavedWorkbenchChartDefinition,
} from "@langwatch/dashboard-contract";
import {
  DashboardRepository,
  type SavedWorkbenchChartRecord,
  type DashboardRecord,
  type DashboardSummaryRecord,
  type GraphRecord,
} from "../../ports/dashboard.port";

const BUILDER_CHART_KIND = "builder";
const WORKBENCH_SQL_CHART_KIND = "workbench_sql";

const toDashboard = (row: PrismaDashboard): DashboardRecord =>
  dashboardSchema.parse({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    order: row.order,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

export class PrismaDashboardRepository extends DashboardRepository {
  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create(prisma: PrismaClient): PrismaDashboardRepository {
    return new PrismaDashboardRepository(prisma);
  }

  async findAllDashboards(input: { projectId: string }): Promise<DashboardSummaryRecord[]> {
    const rows = await this.prisma.dashboard.findMany({
      where: { projectId: input.projectId },
      orderBy: { order: "asc" },
      include: { _count: { select: { graphs: true } } },
    });
    return rows.map((row) => ({ ...toDashboard(row), graphCount: row._count.graphs }));
  }

  async tryFindDashboard(input: {
    projectId: string;
    dashboardId: string;
  }): Promise<(DashboardRecord & { graphs: GraphRecord[] }) | null> {
    const row = await this.prisma.dashboard.findFirst({
      where: { id: input.dashboardId, projectId: input.projectId },
      include: { graphs: { where: { kind: "builder" }, orderBy: [{ gridRow: "asc" }, { gridColumn: "asc" }] } },
    });
    if (!row) return null;
    return {
      ...toDashboard(row),
      graphs: row.graphs.map((graph) => this.toGraph(graph)),
    };
  }

  async tryFindFirstDashboard(input: { projectId: string }): Promise<DashboardRecord | null> {
    const row = await this.prisma.dashboard.findFirst({ where: { projectId: input.projectId }, orderBy: { order: "asc" } });
    return row ? toDashboard(row) : null;
  }

  async tryFindLastDashboard(input: { projectId: string }): Promise<DashboardRecord | null> {
    const row = await this.prisma.dashboard.findFirst({ where: { projectId: input.projectId }, orderBy: { order: "desc" } });
    return row ? toDashboard(row) : null;
  }

  async findDashboardIds(input: { projectId: string; dashboardIds: string[] }): Promise<string[]> {
    const rows = await this.prisma.dashboard.findMany({
      where: { id: { in: input.dashboardIds }, projectId: input.projectId },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async createDashboard(input: { id: string; projectId: string; name: string; order: number }): Promise<DashboardRecord> {
    return toDashboard(await this.prisma.dashboard.create({ data: input }));
  }

  async updateDashboard(input: { projectId: string; dashboardId: string; data: { name: string } }): Promise<DashboardRecord> {
    return toDashboard(await this.prisma.dashboard.update({
      where: { id: input.dashboardId, projectId: input.projectId },
      data: input.data,
    }));
  }

  async deleteDashboard(input: { projectId: string; dashboardId: string }): Promise<DashboardRecord> {
    return toDashboard(await this.prisma.dashboard.delete({
      where: { id: input.dashboardId, projectId: input.projectId },
    }));
  }

  async updateDashboardOrder(input: { projectId: string; dashboardIds: string[] }): Promise<void> {
    await this.prisma.$transaction(
      input.dashboardIds.map((dashboardId, order) =>
        this.prisma.dashboard.update({
          where: { id: dashboardId, projectId: input.projectId },
          data: { order },
        }),
      ),
    );
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
    return rows.map((row) => this.toGraph(row));
  }

  async tryFindGraph(input: { projectId: string; graphId: string }): Promise<GraphRecord | null> {
    const row = await this.prisma.customGraph.findFirst({
      where: {
        id: input.graphId,
        projectId: input.projectId,
        kind: BUILDER_CHART_KIND,
      },
    });
    return row ? this.toGraph(row) : null;
  }

  async tryFindLastGraphGridRow(input: { projectId: string; dashboardId: string }): Promise<number | null> {
    const row = await this.prisma.customGraph.findFirst({
      where: {
        projectId: input.projectId,
        dashboardId: input.dashboardId,
      },
      orderBy: { gridRow: "desc" },
      select: { gridRow: true },
    });
    return row?.gridRow ?? null;
  }

  async createGraph(input: { id: string; projectId: string; name: string; graph: Record<string, unknown>; filters: Record<string, unknown>; dashboardId: string | null; layout: GraphLayout }): Promise<GraphRecord> {
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
    return this.toGraph(row);
  }

  async updateGraph(input: { projectId: string; graphId: string; name?: string; graph?: Record<string, unknown>; filters?: Record<string, unknown> }): Promise<GraphRecord> {
    const row = await this.prisma.customGraph.update({
      where: {
        id: input.graphId,
        projectId: input.projectId,
        kind: BUILDER_CHART_KIND,
      },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.graph === undefined
          ? {}
          : { graph: input.graph as Prisma.InputJsonValue }),
        ...(input.filters === undefined
          ? {}
          : { filters: input.filters as Prisma.InputJsonValue }),
      },
    });
    return this.toGraph(row);
  }

  async deleteGraph(input: { projectId: string; graphId: string }): Promise<GraphRecord> {
    const row = await this.prisma.customGraph.delete({
      where: {
        id: input.graphId,
        projectId: input.projectId,
        kind: BUILDER_CHART_KIND,
      },
    });
    return this.toGraph(row);
  }

  async updateGraphLayout(input: { projectId: string; graphId: string; layout: GraphLayout }): Promise<GraphRecord> {
    const row = await this.prisma.customGraph.update({
      where: {
        id: input.graphId,
        projectId: input.projectId,
        kind: BUILDER_CHART_KIND,
      },
      data: input.layout,
    });
    return this.toGraph(row);
  }

  async updateGraphLayouts(input: { projectId: string; layouts: Array<{ graphId: string; layout: GraphLayout }> }): Promise<void> {
    await this.prisma.$transaction(
      input.layouts.map((item) =>
        this.prisma.customGraph.update({
          where: {
            id: item.graphId,
            projectId: input.projectId,
            kind: BUILDER_CHART_KIND,
          },
          data: item.layout,
        }),
      ),
    );
  }

  async findAllSavedWorkbenchCharts(input: { projectId: string }): Promise<SavedWorkbenchChartRecord[]> {
    const rows = await this.prisma.customGraph.findMany({
      where: {
        projectId: input.projectId,
        kind: WORKBENCH_SQL_CHART_KIND,
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.toSavedWorkbenchChart(row));
  }

  async tryFindSavedWorkbenchChart(input: { projectId: string; chartId: string }): Promise<SavedWorkbenchChartRecord | null> {
    const row = await this.prisma.customGraph.findFirst({
      where: {
        id: input.chartId,
        projectId: input.projectId,
        kind: WORKBENCH_SQL_CHART_KIND,
      },
    });
    return row ? this.toSavedWorkbenchChart(row) : null;
  }

  async createSavedWorkbenchChart(input: { id: string; projectId: string; name: string; definition: SavedWorkbenchChartDefinition }): Promise<SavedWorkbenchChartRecord> {
    const row = await this.prisma.customGraph.create({
      data: {
        id: input.id,
        projectId: input.projectId,
        name: input.name,
        graph: input.definition as Prisma.InputJsonValue,
        kind: WORKBENCH_SQL_CHART_KIND,
      },
    });
    return this.toSavedWorkbenchChart(row);
  }

  async tryUpdateSavedWorkbenchChart(input: { projectId: string; chartId: string; name?: string; definition?: SavedWorkbenchChartDefinition }): Promise<SavedWorkbenchChartRecord | null> {
    const rows = await this.prisma.customGraph.updateManyAndReturn({
      where: {
        id: input.chartId,
        projectId: input.projectId,
        kind: WORKBENCH_SQL_CHART_KIND,
      },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.definition === undefined
          ? {}
          : { graph: input.definition as Prisma.InputJsonValue }),
      },
    });
    const row = rows[0];
    return row ? this.toSavedWorkbenchChart(row) : null;
  }

  async deleteSavedWorkbenchChart(input: { projectId: string; chartId: string }): Promise<number> {
    const result = await this.prisma.customGraph.deleteMany({
      where: {
        id: input.chartId,
        projectId: input.projectId,
        kind: WORKBENCH_SQL_CHART_KIND,
      },
    });
    return result.count;
  }

  private toGraph(row: { id: string; projectId: string; name: string; graph: unknown; filters: unknown; dashboardId: string | null; gridColumn: number; gridRow: number; colSpan: number; rowSpan: number; createdAt: Date; updatedAt: Date }): GraphRecord {
    return graphSchema.parse({
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
  }

  private toSavedWorkbenchChart(row: { id: string; projectId: string; name: string; graph: unknown; createdAt: Date; updatedAt: Date }): SavedWorkbenchChartRecord {
    return savedWorkbenchChartSchema.parse({
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      definition: savedWorkbenchChartDefinitionSchema.parse(row.graph),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
