import type { SavedViewJson, SavedViewRecord } from "../../ports/dashboard.port";
import type { Prisma, PrismaClient, SavedView } from "@langwatch/prisma-client/generated";
import {
  SavedViewRepository,
  type CreateSavedViewInput,
  type UpdateSavedViewInput,
} from "../saved-view.repository";

/**
 * Only the delegate this repository touches, plus the transaction it reorders in.
 *
 * Composition can name this instead of the whole generated client, which keeps
 * `@langwatch/prisma-client/generated` an import of this directory alone.
 */
export type SavedViewDatabase = Pick<PrismaClient, "savedView" | "$transaction">;

/**
 * Repository layer for saved view data access.
 * Single Responsibility: Database operations for saved views.
 *
 * CRITICAL: Every query includes projectId for multitenancy protection.
 */
export class PrismaSavedViewRepository extends SavedViewRepository {
  private constructor(private readonly prisma: SavedViewDatabase) {
    super();
  }

  static create(options: { database: SavedViewDatabase }): PrismaSavedViewRepository {
    return new PrismaSavedViewRepository(options.database);
  }

  /**
   * Finds all saved views visible to a user: project-level views (userId IS NULL)
   * plus the specified user's personal views.
   */
  async findAll(input: {
    projectId: string;
    userId?: string;
    kind?: string;
  }): Promise<SavedViewRecord[]> {
    return await this.prisma.savedView.findMany({
      where: {
        projectId: input.projectId,
        ...(input.kind ? { kind: input.kind } : {}),
        OR: [{ userId: null }, ...(input.userId ? [{ userId: input.userId }] : [])],
      },
      orderBy: { order: "asc" },
    });
  }

  /**
   * Finds a saved view by id within a project, or nothing when the project
   * holds no such view.
   */
  async tryFindById(input: { id: string; projectId: string }): Promise<SavedViewRecord | null> {
    return await this.prisma.savedView.findFirst({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
    });
  }

  /**
   * Finds the last saved view by order for a project, or nothing when the
   * project has none yet.
   */
  async tryFindLast(input: { projectId: string; kind?: string }): Promise<SavedViewRecord | null> {
    return await this.prisma.savedView.findFirst({
      where: {
        projectId: input.projectId,
        ...(input.kind ? { kind: input.kind } : {}),
      },
      orderBy: { order: "desc" },
    });
  }

  /**
   * Finds saved views by their ids within a project.
   */
  async findByIds(input: { ids: string[]; projectId: string }): Promise<Array<{ id: string }>> {
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
  async create(input: CreateSavedViewInput): Promise<SavedViewRecord> {
    return await this.prisma.savedView.create({
      data: {
        id: input.id,
        projectId: input.projectId,
        userId: input.userId,
        name: input.name,
        filters: input.filters as Prisma.InputJsonValue,
        query: input.query,
        period: (input.period ?? undefined) as Prisma.InputJsonValue | undefined,
        order: input.order,
        ...(input.kind ? { kind: input.kind } : {}),
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
        filters: v.filters as Prisma.InputJsonValue,
        query: v.query,
        period: (v.period ?? undefined) as Prisma.InputJsonValue | undefined,
        order: v.order,
        ...(v.kind ? { kind: v.kind } : {}),
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Updates an existing saved view.
   */
  async update(input: UpdateSavedViewInput): Promise<SavedViewRecord> {
    return await this.prisma.savedView.update({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
      data: input.data as Prisma.SavedViewUpdateInput,
    });
  }

  /**
   * Deletes a saved view.
   */
  async delete(input: { id: string; projectId: string }): Promise<SavedViewRecord> {
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
  async updateOrder(input: { projectId: string; viewIds: string[] }): Promise<void> {
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
  async count(input: { projectId: string; userId?: string; kind?: string }): Promise<number> {
    return await this.prisma.savedView.count({
      where: {
        projectId: input.projectId,
        ...(input.kind ? { kind: input.kind } : {}),
        OR: [{ userId: null }, ...(input.userId ? [{ userId: input.userId }] : [])],
      },
    });
  }
}
