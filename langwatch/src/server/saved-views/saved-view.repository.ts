import type { Prisma, PrismaClient, SavedView } from "@prisma/client";

/**
 * Input types for saved view operations.
 */
export type CreateSavedViewInput = {
  id: string;
  projectId: string;
  userId?: string;
  name: string;
  filters: Prisma.InputJsonValue;
  query?: string;
  period?: Prisma.InputJsonValue;
  order: number;
};

export type UpdateSavedViewInput = {
  id: string;
  projectId: string;
  data: Prisma.SavedViewUpdateInput;
};

/**
 * Repository layer for saved view data access.
 * Single Responsibility: Database operations for saved views.
 *
 * CRITICAL: Every query includes projectId for multitenancy protection.
 */
export class SavedViewRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Finds all saved views visible to a user: project-level views (userId IS NULL)
   * plus the specified user's personal views.
   */
  async findAll(input: { projectId: string; userId?: string }): Promise<SavedView[]> {
    return await this.prisma.savedView.findMany({
      where: {
        projectId: input.projectId,
        OR: [
          { userId: null },
          ...(input.userId ? [{ userId: input.userId }] : []),
        ],
      },
      orderBy: { order: "asc" },
    });
  }

  /**
   * Finds a saved view by id within a project.
   */
  async findById(input: {
    id: string;
    projectId: string;
  }): Promise<SavedView | null> {
    return await this.prisma.savedView.findFirst({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
    });
  }

  /**
   * Finds the last saved view by order for a project.
   */
  async findLast(input: { projectId: string }): Promise<SavedView | null> {
    return await this.prisma.savedView.findFirst({
      where: { projectId: input.projectId },
      orderBy: { order: "desc" },
    });
  }

  /**
   * Finds saved views by their ids within a project.
   */
  async findByIds(input: {
    ids: string[];
    projectId: string;
  }): Promise<Array<{ id: string }>> {
    return await this.prisma.savedView.findMany({
      where: {
        id: { in: input.ids },
        projectId: input.projectId,
      },
      select: { id: true },
    });
  }

  /**
   * Creates a new saved view.
   */
  async create(input: CreateSavedViewInput): Promise<SavedView> {
    return await this.prisma.savedView.create({
      data: {
        id: input.id,
        projectId: input.projectId,
        userId: input.userId,
        name: input.name,
        filters: input.filters,
        query: input.query,
        period: input.period ?? undefined,
        order: input.order,
      },
    });
  }

  /**
   * Creates multiple saved views, skipping duplicates.
   * Safe for concurrent first-access seeding.
   */
  async createMany(input: { views: CreateSavedViewInput[] }): Promise<void> {
    await this.prisma.savedView.createMany({
      data: input.views.map((v) => ({
        id: v.id,
        projectId: v.projectId,
        userId: v.userId,
        name: v.name,
        filters: v.filters,
        query: v.query,
        period: v.period ?? undefined,
        order: v.order,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Updates an existing saved view.
   */
  async update(input: UpdateSavedViewInput): Promise<SavedView> {
    return await this.prisma.savedView.update({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
      data: input.data,
    });
  }

  /**
   * Deletes a saved view.
   */
  async delete(input: { id: string; projectId: string }): Promise<SavedView> {
    return await this.prisma.savedView.delete({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
    });
  }

  /**
   * Updates multiple saved views' order in a transaction.
   */
  async updateOrder(input: {
    projectId: string;
    viewIds: string[];
  }): Promise<void> {
    const updates = input.viewIds.map((viewId, index) =>
      this.prisma.savedView.update({
        where: { id: viewId, projectId: input.projectId },
        data: { order: index },
      }),
    );

    await this.prisma.$transaction(updates);
  }

  /**
   * Counts saved views visible to a user: project-level views (userId IS NULL)
   * plus the specified user's personal views.
   */
  async count(input: { projectId: string; userId?: string }): Promise<number> {
    return await this.prisma.savedView.count({
      where: {
        projectId: input.projectId,
        OR: [
          { userId: null },
          ...(input.userId ? [{ userId: input.userId }] : []),
        ],
      },
    });
  }
}
