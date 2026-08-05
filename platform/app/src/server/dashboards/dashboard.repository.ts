import type { Dashboard, Prisma, PrismaClient } from "@prisma/client";

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
   */
  async findAll(input: { projectId: string }): Promise<
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
          select: { graphs: true },
        },
      },
    });
  }

  /**
   * Finds a dashboard by id within a project, including its graphs.
   */
  async findById(input: { id: string; projectId: string }) {
    return await this.prisma.dashboard.findFirst({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
      include: {
        graphs: {
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
