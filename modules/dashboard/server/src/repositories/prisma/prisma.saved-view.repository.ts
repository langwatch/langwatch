import { savedViewSchema } from "@langwatch/dashboard-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import type { Prisma } from "@langwatch/prisma-client/generated";

import type {
  CreateSavedViewInput,
  SavedViewRecord,
  SavedViewRepository,
  UpdateSavedViewInput,
} from "../saved-view.repository.ts";

const savedViewRow = (row: unknown): SavedViewRecord => savedViewSchema.parse(row);

/**
 * Saved-view rows over Postgres.
 *
 * CRITICAL: Every query includes projectId for multitenancy protection.
 */
export class PrismaSavedViewRepository
  extends PrismaRepository.transactionalFor("SavedView")
  implements SavedViewRepository
{
  static readonly create = this.factory((prisma) => new PrismaSavedViewRepository(prisma));

  /**
   * Every saved view visible to a member: the project's own (userId IS NULL)
   * plus that member's personal ones.
   */
  async findAll(input: {
    projectId: string;
    userId?: string;
    kind?: string;
  }): Promise<SavedViewRecord[]> {
    const rows = await this.prisma.savedView.findMany({
      where: {
        projectId: input.projectId,
        ...(input.kind ? { kind: input.kind } : {}),
        OR: [{ userId: null }, ...(input.userId ? [{ userId: input.userId }] : [])],
      },
      orderBy: { order: "asc" },
    });
    return rows.map((row) => savedViewRow(row));
  }

  async findById(input: { id: string; projectId: string }): Promise<SavedViewRecord | undefined> {
    const row = await this.prisma.savedView.findFirst({
      where: { id: input.id, projectId: input.projectId },
    });
    return row ? savedViewRow(row) : undefined;
  }

  /** The last view by order, which is where the next one is appended after. */
  async findLast(input: {
    projectId: string;
    kind?: string;
  }): Promise<SavedViewRecord | undefined> {
    const row = await this.prisma.savedView.findFirst({
      where: {
        projectId: input.projectId,
        ...(input.kind ? { kind: input.kind } : {}),
      },
      orderBy: { order: "desc" },
    });
    return row ? savedViewRow(row) : undefined;
  }

  async findByIds(input: {
    ids: string[];
    projectId: string;
  }): Promise<Array<{ id: string; userId: string | null }>> {
    return await this.prisma.savedView.findMany({
      where: { id: { in: input.ids }, projectId: input.projectId },
      select: { id: true, userId: true },
    });
  }

  async create(input: CreateSavedViewInput): Promise<SavedViewRecord> {
    const row = await this.prisma.savedView.create({
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
    return savedViewRow(row);
  }

  /** Safe for concurrent first-access seeding: duplicates are skipped. */
  async createMany(input: { views: CreateSavedViewInput[] }): Promise<void> {
    await this.prisma.savedView.createMany({
      data: input.views.map((view) => ({
        id: view.id,
        projectId: view.projectId,
        userId: view.userId,
        name: view.name,
        filters: view.filters as Prisma.InputJsonValue,
        query: view.query,
        period: (view.period ?? undefined) as Prisma.InputJsonValue | undefined,
        order: view.order,
        ...(view.kind ? { kind: view.kind } : {}),
      })),
      skipDuplicates: true,
    });
  }

  async update(input: UpdateSavedViewInput): Promise<SavedViewRecord> {
    const row = await this.prisma.savedView.update({
      where: { id: input.id, projectId: input.projectId },
      data: input.data as Prisma.SavedViewUpdateInput,
    });
    return savedViewRow(row);
  }

  async delete(input: { id: string; projectId: string }): Promise<SavedViewRecord> {
    const row = await this.prisma.savedView.delete({
      where: { id: input.id, projectId: input.projectId },
    });
    return savedViewRow(row);
  }

  async updateOrder(input: { projectId: string; viewIds: string[] }): Promise<void> {
    await this.transaction(async (transaction) => {
      for (const [order, viewId] of input.viewIds.entries()) {
        await transaction.savedView.update({
          where: { id: viewId, projectId: input.projectId },
          data: { order },
        });
      }
    });
  }

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
