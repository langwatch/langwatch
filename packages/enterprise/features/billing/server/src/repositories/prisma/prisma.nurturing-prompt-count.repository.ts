import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { NurturingPromptCountRepository } from "../nurturing-prompt-count.repository";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type NurturingPromptCountDatabase = Pick<PrismaClient, "project" | "llmPromptConfig">;

export class PrismaNurturingPromptCountRepository extends NurturingPromptCountRepository {
  private constructor(private readonly prisma: NurturingPromptCountDatabase) {
    super();
  }

  static create(prisma: NurturingPromptCountDatabase): PrismaNurturingPromptCountRepository {
    return new PrismaNurturingPromptCountRepository(prisma);
  }

  async tryFindOrganizationId(projectId: string): Promise<string | undefined> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { organizationId: true } } },
    });
    return project?.team?.organizationId ?? undefined;
  }

  async countOrganizationPrompts(organizationId: string): Promise<number> {
    return this.prisma.llmPromptConfig.count({
      where: {
        organizationId,
        deletedAt: null,
        versions: { some: {} },
      },
    });
  }
}
