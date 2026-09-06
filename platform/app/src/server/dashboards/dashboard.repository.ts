import type {
  Dashboard,
  Prisma,
  PrismaClient,
} from "~/generated/prisma/client";

import { BUILDER_CHART_KIND } from "~/server/analytics/chartKinds";
import type { PlaceableKindWhere } from "~/server/analytics/placeableKindFilter";

/**
 * Input types for dashboard operations
 */
export type CreateDashboardInput = {
  id: string;
  projectId: string;
  name: string;
  order: number;
};

export type UpdateDashboardInput = {
  id: string;
  projectId: string;
  data: Prisma.DashboardUpdateInput;
};

/**
 * Repository layer for dashboard data access.
 * Single Responsibility: Database operations for dashboards.
 */
export class DashboardRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Finds all dashboards for a project, ordered by order field.
   *
   * The card count is scoped by the caller-supplied `kind` clause so the list
   * advertises exactly the cards the dashboard's grid will render — the
   * service derives the clause from the same gate the graph-card procedures
   * apply, which is what keeps the two endpoints of one resource agreeing.
   */
  async findAll(input: {
    projectId: string;
    graphKindWhere: PlaceableKindWhere;
  }): Promise<
    Array<
      Dashboard & {
        _count: { graphs: number };
      }
    >
  > {
    return await this.prisma.dashboard.findMany({
      where: { projectId: input.projectId },
      orderBy: { order: "asc" },
      include: {
        _count: {
          select: { graphs: { where: input.graphKindWhere } },
        },
      },
    });
  }

  /**
   * Finds a dashboard by id within a project, including its builder graphs.
   *
   * The `kind` predicate is load-bearing rather than tidy. This read feeds the
   * v1 REST `GET /dashboards/{id}` response, which serialises each graph row
   * wholesale — and a saved LangWatchQL workbench chart's `graph` column holds
   * `{ sql, parameters, vegaLiteSpec }`, so including one here publishes a
   * member's stored SQL to any project API key that can read a dashboard.
   * Scoping the include is what keeps the discriminator's promise (neither kind
   * sees the other's rows) true on the way out as well as on the way in.
   *
   * Workbench charts placed on a dashboard are rendered by the application's
   * own widget surface, which reads them through the saved-chart service and
   * its own gates, never through this row.
   *
   * @see ~/server/analytics/chartKinds — the discriminator
   * @see specs/analytics/dashboard-rest-api.feature
   */
  async findById(input: { id: string; projectId: string }) {
    return await this.prisma.dashboard.findFirst({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
      include: {
        graphs: {
          where: { kind: BUILDER_CHART_KIND },
          orderBy: [{ gridRow: "asc" }, { gridColumn: "asc" }],
        },
      },
    });
  }

  /**
   * Finds the first dashboard for a project (by order).
   */
  async findFirst(input: { projectId: string }): Promise<Dashboard | null> {
    return await this.prisma.dashboard.findFirst({
      where: { projectId: input.projectId },
      orderBy: { order: "asc" },
    });
  }

  /**
   * Finds the last dashboard by order for a project.
   */
  async findLast(input: { projectId: string }): Promise<Dashboard | null> {
    return await this.prisma.dashboard.findFirst({
      where: { projectId: input.projectId },
      orderBy: { order: "desc" },
    });
  }

  /**
   * Finds dashboards by their ids within a project.
   */
  async findByIds(input: {
    ids: string[];
    projectId: string;
  }): Promise<Array<{ id: string }>> {
    return await this.prisma.dashboard.findMany({
      where: {
        id: { in: input.ids },
        projectId: input.projectId,
      },
      select: { id: true },
    });
  }

  /**
   * Creates a new dashboard.
   */
  async create(input: CreateDashboardInput): Promise<Dashboard> {
    return await this.prisma.dashboard.create({
      data: input,
    });
  }

  /**
   * Updates an existing dashboard.
   */
  async update(input: UpdateDashboardInput): Promise<Dashboard> {
    return await this.prisma.dashboard.update({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
      data: input.data,
    });
  }

  /**
   * Deletes a dashboard (cascades to graphs).
   */
  async delete(input: { id: string; projectId: string }): Promise<Dashboard> {
    return await this.prisma.dashboard.delete({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
    });
  }

  /**
   * Updates multiple dashboards' order in a transaction.
   */
  async updateOrder(
    input: { projectId: string; dashboardIds: string[] },
    prisma?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = prisma ?? this.prisma;
    const updates = input.dashboardIds.map((dashboardId, index) =>
      client.dashboard.update({
        where: { id: dashboardId, projectId: input.projectId },
        data: { order: index },
      }),
    );

    if (prisma) {
      await Promise.all(updates);
    } else {
      await this.prisma.$transaction(updates);
    }
  }
}
