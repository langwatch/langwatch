import type { LangyProjectMemory, PrismaClient, Prisma } from "@prisma/client";

export type ChangeReason = "auto_bootstrap" | "auto_refresh" | "user_edit" | "user_refresh";

// Accepts the top-level PrismaClient or a Prisma.TransactionClient (the
// scoped client passed into $transaction callbacks). Both expose the same
// model accessors; only $-prefix helpers differ.
type MemoryDb = Pick<PrismaClient, "langyProjectMemory" | "langyProjectMemoryHistory">;

export class LangyProjectMemoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById({ projectId }: { projectId: string }) {
    return await this.prisma.langyProjectMemory.findFirst({
      where: { projectId },
    });
  }

  async upsert(
    {
      projectId,
      content,
      contentSummary,
      lastEditorId,
    }: {
      projectId: string;
      content: string;
      contentSummary?: string | null;
      lastEditorId?: string | null;
    },
    tx?: MemoryDb,
  ) {
    const db = tx ?? this.prisma;
    const existing = await db.langyProjectMemory.findFirst({
      where: { projectId },
    });
    if (existing) {
      await db.langyProjectMemory.updateMany({
        where: { id: existing.id, projectId },
        data: {
          content,
          contentSummary: contentSummary ?? null,
          contentVersion: existing.contentVersion + 1,
          refreshedAt: new Date(),
          lastEditorId: lastEditorId ?? null,
        },
      });
      return (await db.langyProjectMemory.findFirst({
        where: { projectId },
      }))!;
    }
    return await db.langyProjectMemory.create({
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
    private readonly prisma: PrismaClient,
  ) {}

  static create(prisma: PrismaClient): LangyProjectMemoryService {
    return new LangyProjectMemoryService(
      new LangyProjectMemoryRepository(prisma),
      LangyProjectMemoryHistoryService.create(prisma),
      prisma,
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
    // Memory upsert + history append must be atomic — otherwise a failure
    // between steps leaves memory at v(N+1) with no history row at v(N+1),
    // breaking rollback.
    return await this.prisma.$transaction(async (tx) => {
      const memory = await this.repository.upsert(
        {
          projectId,
          content,
          contentSummary,
          lastEditorId: changedById,
        },
        tx as MemoryDb,
      );
      await this.historyService.append(
        {
          projectMemoryId: memory.id,
          projectId,
          contentVersion: memory.contentVersion,
          content,
          changedById,
          changeReason,
        },
        tx as MemoryDb,
      );
      return memory;
    });
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

  async create(
    input: {
      projectMemoryId: string;
      projectId: string;
      contentVersion: number;
      content: string;
      changedById?: string | null;
      changeReason?: string | null;
    },
    tx?: MemoryDb,
  ) {
    const db = tx ?? this.prisma;
    return await db.langyProjectMemoryHistory.create({
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

  async append(
    input: {
      projectMemoryId: string;
      projectId: string;
      contentVersion: number;
      content: string;
      changedById?: string | null;
      changeReason: ChangeReason;
    },
    tx?: MemoryDb,
  ) {
    return await this.repository.create(input, tx);
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
