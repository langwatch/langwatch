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
  type GraphLayout,
  type SavedWorkbenchChartDefinition,
  type DashboardScope,
  type DashboardStar,
  type DashboardUsageCount,
  type StarredDashboard,
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
  MemberStars,
  SavedWorkbenchChartRecord,
} from "../dashboard.repository.ts";

const BUILDER_CHART_KIND = "builder";
const WORKBENCH_SQL_CHART_KIND = "workbench_sql";

/** The column a star matches on: the board id for a board, the template id for a template. */
const starTarget = (star: DashboardStar) =>
  star.kind === "board" ? { dashboardId: star.dashboardId } : { templateId: star.templateId };

/**
 * The rows a read reaches: the project's own, and with an organization its shared boards.
 * Always an OR of tenancy predicates, which is the shape the tenancy guard admits.
 */
const reached = ({ projectId, organizationId }: DashboardReach): Prisma.DashboardWhereInput =>
  organizationId === undefined
    ? { projectId }
    : { OR: [{ projectId }, { organizationId, scope: "ORGANIZATION" }] };

/** Every project whose stars this project lists: its own, then the shared boards' owners. */
const starProjects = ({ projectId, sharedProjectIds = [] }: MemberStars): string[] => [
  projectId,
  ...sharedProjectIds,
];

/** A member's star rows as one project lists them: its templates, and boards of every owner. */
const memberStars = (input: MemberStars): Prisma.DashboardFavouriteWhereInput => ({
  userId: input.userId,
  OR: [
    { projectId: input.projectId },
    { projectId: { in: starProjects(input) }, dashboardId: { not: null } },
  ],
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
  extends PrismaRepository.transactionalFor("Dashboard", "CustomGraph", "DashboardFavourite")
  implements DashboardRepository
{
  static readonly create = this.factory((prisma) => new PrismaDashboardRepository(prisma));

  async countUsage({
    projectIds,
  }: {
    projectIds: readonly string[];
  }): Promise<DashboardUsageCount> {
    const inScope = { projectId: { in: [...projectIds] } };
    const [builderCharts, charts] = await Promise.all([
      this.prisma.customGraph.count({ where: { ...inScope, kind: BUILDER_CHART_KIND } }),
      this.prisma.customGraph.count({ where: inScope }),
    ]);
    return { builderCharts, charts };
  }

  async findAllDashboards(
    input: DashboardReach & { graphKinds: readonly DashboardGraphKind[] },
  ): Promise<DashboardSummaryRecord[]> {
    const rows = await this.prisma.dashboard.findMany({
      where: reached(input),
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
    const dashboardIds = rows.map((row) => row.id);
    // A card is stored under the project that owns its board, so count there.
    const ownerProjectIds = [...new Set(rows.map((row) => row.projectId))];
    const counts =
      dashboardIds.length > 0
        ? await this.prisma.customGraph.groupBy({
            by: ["dashboardId"],
            where: {
              projectId: { in: ownerProjectIds },
              dashboardId: { in: dashboardIds },
              kind: { in: [...input.graphKinds] },
            },
            _count: { _all: true },
          })
        : [];
    const graphCounts = new Map(counts.map((count) => [count.dashboardId, count._count._all]));
    const summaries = rows.map((row) => ({
      ...dashboardRow(row),
      graphCount: graphCounts.get(row.id) ?? 0,
    }));
    return [
      ...summaries.filter((row) => row.projectId === input.projectId),
      ...summaries.filter((row) => row.projectId !== input.projectId),
    ];
  }

  async findDashboard(
    input: DashboardReach & { dashboardId: string },
  ): Promise<(DashboardRecord & { graphs: GraphRecord[] }) | undefined> {
    const row = await this.prisma.dashboard.findFirst({
      where: { id: input.dashboardId, ...reached(input) },
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

  async findDashboards(
    input: DashboardReach & { dashboardIds: string[] },
  ): Promise<DashboardRecord[]> {
    const rows = await this.prisma.dashboard.findMany({
      where: { id: { in: input.dashboardIds }, ...reached(input) },
    });
    return rows.map((row) => dashboardRow(row));
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
    createdById?: string | null;
    scope?: DashboardScope;
  }): Promise<DashboardRecord> {
    return dashboardRow(
      await this.prisma.dashboard.create({
        data: { ...input, createdById: input.createdById ?? null },
      }),
    );
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
    // Graphs cascade by foreign key; favourites have none, so remove them here.
    return this.transaction(async (transaction) => {
      await transaction.dashboardFavourite.deleteMany({
        where: { dashboardId: input.dashboardId, projectId: input.projectId },
      });
      return dashboardRow(
        await transaction.dashboard.delete({
          where: { id: input.dashboardId, projectId: input.projectId },
        }),
      );
    });
  }

  async findStarred(input: MemberStars): Promise<StarredDashboard[]> {
    const favourites = await this.prisma.dashboardFavourite.findMany({
      where: memberStars(input),
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { dashboardId: true, templateId: true },
    });
    const boardIds = favourites.flatMap((row) =>
      row.dashboardId === null ? [] : [row.dashboardId],
    );
    const rows =
      boardIds.length === 0
        ? []
        : await this.prisma.dashboard.findMany({
            where: { projectId: { in: starProjects(input) }, id: { in: boardIds } },
          });
    const byId = new Map(rows.map((row) => [row.id, dashboardRow(row)]));
    return favourites.flatMap((favourite): StarredDashboard[] => {
      if (favourite.templateId !== null) {
        return [{ kind: "template", templateId: favourite.templateId }];
      }
      const dashboard =
        favourite.dashboardId === null ? undefined : byId.get(favourite.dashboardId);
      return dashboard ? [{ kind: "board", dashboard }] : [];
    });
  }

  async findStarredDashboardIds(input: MemberStars): Promise<string[]> {
    const rows = await this.prisma.dashboardFavourite.findMany({
      where: {
        userId: input.userId,
        projectId: { in: starProjects(input) },
        dashboardId: { not: null },
      },
      orderBy: { position: "asc" },
      select: { dashboardId: true },
    });
    return rows.flatMap((row) => (row.dashboardId === null ? [] : [row.dashboardId]));
  }

  async addStar(input: {
    projectId: string;
    userId: string;
    star: DashboardStar;
    listedInProjectId?: string;
  }): Promise<void> {
    const where = {
      projectId: input.projectId,
      userId: input.userId,
      ...starTarget(input.star),
    };
    // The end of the order the member sees where they starred it, not only where it is stored.
    const listedIn = [...new Set([input.projectId, input.listedInProjectId ?? input.projectId])];
    await this.transaction(async (transaction) => {
      const existing = await transaction.dashboardFavourite.findFirst({
        where,
        select: { id: true },
      });
      if (existing) return;
      const last = await transaction.dashboardFavourite.findFirst({
        where: { projectId: { in: listedIn }, userId: input.userId },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      await transaction.dashboardFavourite.create({
        data: { ...where, position: (last?.position ?? -1) + 1 },
      });
    });
  }

  async removeStar(input: {
    projectId: string;
    userId: string;
    star: DashboardStar;
  }): Promise<void> {
    await this.prisma.dashboardFavourite.deleteMany({
      where: { projectId: input.projectId, userId: input.userId, ...starTarget(input.star) },
    });
  }

  async reorderStars(input: MemberStars & { stars: DashboardStar[] }): Promise<void> {
    const boardProjects = { in: starProjects(input) };
    await this.transaction(async (transaction) => {
      // Rows are matched by target, so only stars the member holds are moved.
      await Promise.all(
        input.stars.map((star, position) =>
          transaction.dashboardFavourite.updateMany({
            where: {
              projectId: star.kind === "board" ? boardProjects : input.projectId,
              userId: input.userId,
              ...starTarget(star),
            },
            data: { position },
          }),
        ),
      );
    });
  }

  async countOtherStars(input: {
    projectId: string;
    dashboardId: string;
    userId: string;
  }): Promise<number> {
    return this.prisma.dashboardFavourite.count({
      where: {
        projectId: input.projectId,
        dashboardId: input.dashboardId,
        userId: { not: input.userId },
      },
    });
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

  async findNextFreeGridRow(input: { projectId: string; dashboardId: string }): Promise<number> {
    const cards = await this.prisma.customGraph.findMany({
      where: { projectId: input.projectId, dashboardId: input.dashboardId },
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
