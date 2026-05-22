import type { LangyProjectMemory, PrismaClient } from "@prisma/client";

export type ChangeReason = "auto_bootstrap" | "auto_refresh" | "user_edit" | "user_refresh";

export class LangyProjectMemoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById({ projectId }: { projectId: string }) {
    return await this.prisma.langyProjectMemory.findFirst({
      where: { projectId },
    });
  }

  async upsert({
    projectId,
    content,
    contentSummary,
    lastEditorId,
  }: {
    projectId: string;
    content: string;
    contentSummary?: string | null;
    lastEditorId?: string | null;
  }) {
    const existing = await this.prisma.langyProjectMemory.findFirst({
      where: { projectId },
    });
    if (existing) {
      await this.prisma.langyProjectMemory.updateMany({
        where: { id: existing.id, projectId },
        data: {
          content,
          contentSummary: contentSummary ?? null,
          contentVersion: existing.contentVersion + 1,
          refreshedAt: new Date(),
          lastEditorId: lastEditorId ?? null,
        },
      });
      return (await this.prisma.langyProjectMemory.findFirst({
        where: { projectId },
      }))!;
    }
    return await this.prisma.langyProjectMemory.create({
      data: {
        projectId,
        content,
        contentSummary: contentSummary ?? null,
        contentVersion: 1,
        lastEditorId: lastEditorId ?? null,
      },
    });
  }

  async deleteByProjectId({ projectId }: { projectId: string }) {
    return await this.prisma.langyProjectMemory.deleteMany({
      where: { projectId },
    });
  }
}

export class LangyProjectMemoryService {
  constructor(
    private readonly repository: LangyProjectMemoryRepository,
    private readonly historyService: LangyProjectMemoryHistoryService,
  ) {}

  static create(prisma: PrismaClient): LangyProjectMemoryService {
    return new LangyProjectMemoryService(
      new LangyProjectMemoryRepository(prisma),
      LangyProjectMemoryHistoryService.create(prisma),
    );
  }

  async getById({
    projectId,
  }: {
    projectId: string;
  }): Promise<LangyProjectMemory | null> {
    return await this.repository.findById({ projectId });
  }

  async writeNewVersion({
    projectId,
    content,
    contentSummary,
    changedById,
    changeReason,
  }: {
    projectId: string;
    content: string;
    contentSummary?: string | null;
    changedById?: string | null;
    changeReason: ChangeReason;
  }): Promise<LangyProjectMemory> {
    const memory = await this.repository.upsert({
      projectId,
      content,
      contentSummary,
      lastEditorId: changedById,
    });
    await this.historyService.append({
      projectMemoryId: memory.id,
      projectId,
      contentVersion: memory.contentVersion,
      content,
      changedById,
      changeReason,
    });
    return memory;
  }

  async isStale({
    projectId,
    olderThanDays = 30,
  }: {
    projectId: string;
    olderThanDays?: number;
  }): Promise<boolean> {
    const memory = await this.getById({ projectId });
    if (!memory) return false;
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    return memory.refreshedAt.getTime() < cutoff;
  }

  async deleteByProjectId({ projectId }: { projectId: string }) {
    await this.repository.deleteByProjectId({ projectId });
  }
}

export class LangyProjectMemoryHistoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: {
    projectMemoryId: string;
    projectId: string;
    contentVersion: number;
    content: string;
    changedById?: string | null;
    changeReason?: string | null;
  }) {
    return await this.prisma.langyProjectMemoryHistory.create({
      data: {
        projectMemoryId: input.projectMemoryId,
        projectId: input.projectId,
        contentVersion: input.contentVersion,
        content: input.content,
        changedById: input.changedById ?? null,
        changeReason: input.changeReason ?? null,
      },
    });
  }

  async findAll({
    projectMemoryId,
    projectId,
  }: {
    projectMemoryId: string;
    projectId: string;
  }) {
    return await this.prisma.langyProjectMemoryHistory.findMany({
      where: { projectMemoryId, projectId },
      orderBy: { changedAt: "desc" },
    });
  }
}

export class LangyProjectMemoryHistoryService {
  constructor(private readonly repository: LangyProjectMemoryHistoryRepository) {}

  static create(prisma: PrismaClient): LangyProjectMemoryHistoryService {
    return new LangyProjectMemoryHistoryService(
      new LangyProjectMemoryHistoryRepository(prisma),
    );
  }

  async append(input: {
    projectMemoryId: string;
    projectId: string;
    contentVersion: number;
    content: string;
    changedById?: string | null;
    changeReason: ChangeReason;
  }) {
    return await this.repository.create(input);
  }

  async getAll({
    projectMemoryId,
    projectId,
  }: {
    projectMemoryId: string;
    projectId: string;
  }) {
    return await this.repository.findAll({ projectMemoryId, projectId });
  }
}
