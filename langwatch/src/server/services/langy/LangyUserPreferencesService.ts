import type { LangyUserPreferences, PrismaClient } from "@prisma/client";

export type LangyMode = "non_expert" | "expert";

export class LangyUserPreferencesRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById({
    userId,
    projectId,
  }: {
    userId: string;
    projectId: string;
  }) {
    return await this.prisma.langyUserPreferences.findFirst({
      where: { userId, projectId },
    });
  }

  async upsert({
    userId,
    projectId,
    mode,
    dismissedSuggestionKinds,
  }: {
    userId: string;
    projectId: string;
    mode?: LangyMode;
    dismissedSuggestionKinds?: string[];
  }) {
    // Avoid Prisma's compound-unique upsert because the multi-tenancy
    // middleware only recognizes `projectId` (or specific compound keys)
    // in `where`. Do an explicit find → update / create.
    const existing = await this.prisma.langyUserPreferences.findFirst({
      where: { userId, projectId },
    });
    if (existing) {
      await this.prisma.langyUserPreferences.updateMany({
        where: { id: existing.id, projectId },
        data: {
          ...(mode !== undefined ? { mode } : {}),
          ...(dismissedSuggestionKinds !== undefined
            ? { dismissedSuggestionKinds }
            : {}),
        },
      });
      return (await this.prisma.langyUserPreferences.findFirst({
        where: { userId, projectId },
      }))!;
    }
    return await this.prisma.langyUserPreferences.create({
      data: {
        userId,
        projectId,
        mode: mode ?? "non_expert",
        dismissedSuggestionKinds: dismissedSuggestionKinds ?? [],
      },
    });
  }

  async deleteByUserAndProject({
    userId,
    projectId,
  }: {
    userId: string;
    projectId: string;
  }) {
    return await this.prisma.langyUserPreferences.deleteMany({
      where: { userId, projectId },
    });
  }
}

export class LangyUserPreferencesService {
  constructor(private readonly repository: LangyUserPreferencesRepository) {}

  static create(prisma: PrismaClient): LangyUserPreferencesService {
    return new LangyUserPreferencesService(
      new LangyUserPreferencesRepository(prisma),
    );
  }

  async getById({
    userId,
    projectId,
  }: {
    userId: string;
    projectId: string;
  }): Promise<LangyUserPreferences> {
    const existing = await this.repository.findById({ userId, projectId });
    if (existing) return existing;
    return await this.repository.upsert({ userId, projectId });
  }

  async setMode({
    userId,
    projectId,
    mode,
  }: {
    userId: string;
    projectId: string;
    mode: LangyMode;
  }): Promise<LangyUserPreferences> {
    return await this.repository.upsert({ userId, projectId, mode });
  }

  async setDismissedSuggestionKinds({
    userId,
    projectId,
    kinds,
  }: {
    userId: string;
    projectId: string;
    kinds: string[];
  }): Promise<LangyUserPreferences> {
    return await this.repository.upsert({
      userId,
      projectId,
      dismissedSuggestionKinds: kinds,
    });
  }

  async resetForUser({
    userId,
    projectId,
  }: {
    userId: string;
    projectId: string;
  }) {
    await this.repository.deleteByUserAndProject({ userId, projectId });
  }
}
