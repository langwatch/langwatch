import type { LangyConversation, PrismaClient } from "@prisma/client";

export type ConversationListItem = {
  id: string;
  title: string | null;
  isShared: boolean;
  isOwn: boolean;
  updatedAt: Date;
  messageCount: number;
};

export class LangyConversationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<LangyConversation | null> {
    return await this.prisma.langyConversation.findFirst({
      where: { id, projectId, deletedAt: null },
    });
  }

  async findAllForUser({
    projectId,
    userId,
    limit,
  }: {
    projectId: string;
    userId: string;
    limit: number;
  }) {
    return await this.prisma.langyConversation.findMany({
      where: {
        projectId,
        deletedAt: null,
        OR: [{ userId }, { isShared: true }],
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      include: { _count: { select: { messages: true } } },
    });
  }

  async create({
    projectId,
    userId,
    title,
  }: {
    projectId: string;
    userId: string;
    title?: string | null;
  }): Promise<LangyConversation> {
    return await this.prisma.langyConversation.create({
      data: { projectId, userId, title: title ?? null },
    });
  }

  async update({
    id,
    projectId,
    data,
  }: {
    id: string;
    projectId: string;
    data: Partial<{
      title: string | null;
      isShared: boolean;
      sharedAt: Date | null;
      sharedById: string | null;
    }>;
  }) {
    return await this.prisma.langyConversation.updateMany({
      where: { id, projectId },
      data,
    });
  }

  async softDelete({ id, projectId }: { id: string; projectId: string }) {
    return await this.prisma.langyConversation.updateMany({
      where: { id, projectId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  async softDeleteAllForUser({
    projectId,
    userId,
  }: {
    projectId: string;
    userId: string;
  }) {
    return await this.prisma.langyConversation.updateMany({
      where: { projectId, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  async hardDeleteOlderThan({
    cutoff,
  }: {
    cutoff: Date;
  }) {
    // Multi-tenancy guard requires projectId (or projectId.in) in WHERE.
    // Project is exempt from the guard — enumerate projects, then sweep
    // each one's soft-deleted conversations in a batched IN clause.
    const projects = await this.prisma.project.findMany({
      select: { id: true },
    });
    if (projects.length === 0) return { count: 0 };
    return await this.prisma.langyConversation.deleteMany({
      where: {
        projectId: { in: projects.map((p) => p.id) },
        deletedAt: { not: null, lt: cutoff },
      },
    });
  }

  async touch({ id, projectId }: { id: string; projectId: string }) {
    return await this.prisma.langyConversation.updateMany({
      where: { id, projectId },
      data: { updatedAt: new Date() },
    });
  }
}

export class LangyConversationService {
  constructor(private readonly repository: LangyConversationRepository) {}

  static create(prisma: PrismaClient): LangyConversationService {
    return new LangyConversationService(new LangyConversationRepository(prisma));
  }

  async getById({
    id,
    projectId,
    userId,
  }: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<LangyConversation | null> {
    const conv = await this.repository.findById({ id, projectId });
    if (!conv) return null;
    if (conv.userId !== userId && !conv.isShared) return null;
    return conv;
  }

  async getAll({
    projectId,
    userId,
    limit = 50,
  }: {
    projectId: string;
    userId: string;
    limit?: number;
  }): Promise<ConversationListItem[]> {
    const rows = await this.repository.findAllForUser({
      projectId,
      userId,
      limit,
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      isShared: r.isShared,
      isOwn: r.userId === userId,
      updatedAt: r.updatedAt,
      messageCount: r._count.messages,
    }));
  }

  async ensureConversation({
    projectId,
    userId,
    conversationId,
    title,
  }: {
    projectId: string;
    userId: string;
    conversationId?: string | null;
    title?: string | null;
  }): Promise<LangyConversation> {
    if (conversationId) {
      const existing = await this.getById({
        id: conversationId,
        projectId,
        userId,
      });
      if (existing && existing.userId === userId) return existing;
    }
    return await this.repository.create({ projectId, userId, title });
  }

  async deleteById({
    id,
    projectId,
    userId,
  }: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<boolean> {
    const conv = await this.getById({ id, projectId, userId });
    if (!conv || conv.userId !== userId) return false;
    const result = await this.repository.softDelete({ id, projectId });
    return result.count > 0;
  }

  async updateById({
    id,
    projectId,
    userId,
    title,
    isShared,
  }: {
    id: string;
    projectId: string;
    userId: string;
    title?: string | null;
    isShared?: boolean;
  }) {
    const conv = await this.getById({ id, projectId, userId });
    if (!conv || conv.userId !== userId) {
      throw new Error("conversation not found or not owned");
    }
    const data: Parameters<LangyConversationRepository["update"]>[0]["data"] = {};
    if (title !== undefined) data.title = title;
    if (isShared !== undefined) {
      data.isShared = isShared;
      data.sharedAt = isShared ? new Date() : null;
      data.sharedById = isShared ? userId : null;
    }
    await this.repository.update({ id, projectId, data });
    return await this.repository.findById({ id, projectId });
  }

  async clearAllForUser({
    projectId,
    userId,
  }: {
    projectId: string;
    userId: string;
  }) {
    const result = await this.repository.softDeleteAllForUser({
      projectId,
      userId,
    });
    return { deletedCount: result.count };
  }

  async hardDeleteOlderThan({
    cutoff,
  }: {
    cutoff: Date;
  }): Promise<{ deletedCount: number }> {
    const result = await this.repository.hardDeleteOlderThan({ cutoff });
    return { deletedCount: result.count };
  }

  async touch({ id, projectId }: { id: string; projectId: string }) {
    await this.repository.touch({ id, projectId });
  }
}
