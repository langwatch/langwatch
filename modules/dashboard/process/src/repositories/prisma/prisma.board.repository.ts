import { DASHBOARD_SRCDOC_CHART_KIND } from "@langwatch/analytics-contract";
import {
  boardSchema,
  DashboardNotFoundError,
  dashboardHomeProductSchema,
  DEFAULT_DASHBOARD_HOME_PRODUCT,
  type DashboardHomeProduct,
  type DashboardScope,
  type DashboardStar,
  type StarredDashboard,
} from "@langwatch/dashboard-contract";
import { isRecordNotFoundError, PrismaRepository } from "@langwatch/prisma-client";
import type { DashboardsV2, Prisma } from "@langwatch/prisma-client/generated";

import { starredBoardRow } from "../../rules/starred-board-row.rules.ts";
import type {
  BoardReach,
  BoardRecord,
  BoardRepository,
  BoardSummaryRecord,
  BoardUpdate,
  MemberStars,
  SidebarOrderKey,
} from "../board.repository.ts";

/** The column a star matches on: the board id for a board, the template id for a template. */
const starTarget = (star: DashboardStar) =>
  star.kind === "board" ? { dashboardId: star.dashboardId } : { templateId: star.templateId };

/**
 * The rows a read reaches: the project's own, and with an organization the boards its live
 * projects share. Always an OR of tenancy predicates, which is the shape the tenancy guard admits.
 */
const reached = ({ projectId, organization }: BoardReach): Prisma.DashboardsV2WhereInput =>
  organization === undefined
    ? { projectId }
    : {
        OR: [
          { projectId },
          {
            projectId: { in: [...organization.liveProjectIds] },
            organizationId: organization.organizationId,
            scope: "ORGANIZATION",
          },
        ],
      };

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

/** A home this release does not know (a newer one wrote it) lists where every old board does. */
const homeProductOf = (stored: string): DashboardHomeProduct =>
  dashboardHomeProductSchema.catch(DEFAULT_DASHBOARD_HOME_PRODUCT).parse(stored);

const boardRow = (row: DashboardsV2): BoardRecord =>
  boardSchema.parse({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    order: 0,
    description: row.description,
    createdById: row.createdById,
    scope: row.scope,
    organizationId: row.organizationId,
    homeProduct: homeProductOf(row.homeProduct),
    myDashboardOfUserId: row.myDashboardOfUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

export class PrismaBoardRepository
  extends PrismaRepository.transactionalFor(
    "DashboardsV2",
    "DashboardWidget",
    "DashboardFavourite",
    "CustomGraph",
    "Dashboard",
    "DashboardSidebarOrder",
  )
  implements BoardRepository
{
  static readonly create = this.factory((prisma) => new PrismaBoardRepository(prisma));

  async findBoards(input: BoardReach): Promise<BoardSummaryRecord[]> {
    const rows = await this.prisma.dashboardsV2.findMany({
      where: reached(input),
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    // A widget is stored under the project that owns its board, so count there.
    const counts =
      rows.length > 0
        ? await this.prisma.dashboardWidget.groupBy({
            by: ["dashboardId"],
            where: {
              projectId: { in: [...new Set(rows.map((row) => row.projectId))] },
              dashboardId: { in: rows.map((row) => row.id) },
            },
            _count: { _all: true },
          })
        : [];
    const widgetCounts = new Map(counts.map((count) => [count.dashboardId, count._count._all]));
    const summaries = rows.map((row) => ({
      ...boardRow(row),
      graphCount: widgetCounts.get(row.id) ?? 0,
    }));
    return [
      ...summaries.filter((row) => row.projectId === input.projectId),
      ...summaries.filter((row) => row.projectId !== input.projectId),
    ];
  }

  // Reads every board of these projects and leaves the filtering to the caller, in memory:
  // fine for today's board counts, the first thing to narrow if organizations grow large.
  async findBoardsInProjects(input: { projectIds: readonly string[] }): Promise<BoardRecord[]> {
    if (input.projectIds.length === 0) return [];
    const rows = await this.prisma.dashboardsV2.findMany({
      where: { projectId: { in: [...input.projectIds] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => boardRow(row));
  }

  async findBoardsByIds(
    input: BoardReach & { dashboardIds: readonly string[] },
  ): Promise<BoardRecord[]> {
    if (input.dashboardIds.length === 0) return [];
    const rows = await this.prisma.dashboardsV2.findMany({
      where: { id: { in: [...input.dashboardIds] }, ...reached(input) },
    });
    return rows.map((row) => boardRow(row));
  }

  async createBoard(input: {
    id: string;
    projectId: string;
    name: string;
    createdById?: string | null;
    scope?: DashboardScope;
    homeProduct?: DashboardHomeProduct;
    myDashboardOfUserId?: string | null;
    organizationId?: string | null;
  }): Promise<BoardRecord> {
    return boardRow(
      await this.prisma.dashboardsV2.create({
        data: { ...input, createdById: input.createdById ?? null },
      }),
    );
  }

  async updateBoard(input: {
    projectId: string;
    dashboardId: string;
    data: BoardUpdate;
  }): Promise<BoardRecord> {
    return boardRow(
      await this.prisma.dashboardsV2.update({
        where: { id: input.dashboardId, projectId: input.projectId },
        data: input.data,
      }),
    );
  }

  async deleteBoard(input: { projectId: string; dashboardId: string }): Promise<BoardRecord> {
    const { projectId, dashboardId } = input;
    return this.transaction(async (transaction) => {
      // First, so an id only Reports holds is refused before anything else is touched.
      // P2025: no DashboardsV2 row matched (unknown id, another project, a Reports-only id,
      // or a second delete that raced this one).
      const board = await transaction.dashboardsV2
        .delete({ where: { id: dashboardId, projectId } })
        .catch((error: unknown) => {
          throw isRecordNotFoundError(error) ? new DashboardNotFoundError({ projectId }) : error;
        });
      await transaction.dashboardWidget.deleteMany({ where: { projectId, dashboardId } });
      await transaction.dashboardFavourite.deleteMany({ where: { projectId, dashboardId } });
      await transaction.customGraph.deleteMany({
        where: { projectId, dashboardId, kind: DASHBOARD_SRCDOC_CHART_KIND },
      });
      // What is left on the legacy row is Reports' own: it keeps the row, its charts and alerts.
      const reportsCharts = await transaction.customGraph.count({
        where: { projectId, dashboardId },
      });
      if (reportsCharts === 0) {
        await transaction.dashboard.deleteMany({ where: { id: dashboardId, projectId } });
      }
      return boardRow(board);
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
        : await this.prisma.dashboardsV2.findMany({
            where: { projectId: { in: starProjects(input) }, id: { in: boardIds } },
          });
    const byId = new Map(rows.map((row) => [row.id, boardRow(row)]));
    return favourites.flatMap((favourite): StarredDashboard[] => {
      if (favourite.templateId !== null) {
        return [{ kind: "template", templateId: favourite.templateId }];
      }
      const dashboard =
        favourite.dashboardId === null ? undefined : byId.get(favourite.dashboardId);
      return dashboard ? [{ kind: "board", dashboard: starredBoardRow({ board: dashboard }) }] : [];
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

  async findSidebarOrder(input: SidebarOrderKey): Promise<string[]> {
    const row = await this.prisma.dashboardSidebarOrder.findUnique({
      where: { userId_organizationId_homeProduct: input },
      select: { dashboardIds: true },
    });
    return row?.dashboardIds ?? [];
  }

  async setSidebarOrder(
    input: SidebarOrderKey & { dashboardIds: readonly string[] },
  ): Promise<void> {
    const { dashboardIds, ...key } = input;
    await this.prisma.dashboardSidebarOrder.upsert({
      where: { userId_organizationId_homeProduct: key },
      create: { ...key, dashboardIds: [...dashboardIds] },
      update: { dashboardIds: [...dashboardIds] },
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
}
