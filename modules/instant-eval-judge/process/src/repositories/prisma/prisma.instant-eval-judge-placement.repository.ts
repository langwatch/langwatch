import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  type InstantEvalJudgeProjectPlacement,
  InstantEvalJudgeProjectRepository,
} from "../instant-eval-judge-placement.repository.ts";

/** Only the shared delegates this reader touches; it claims no table (R40). */
type PrismaInstantEvalJudgeProjectDatabase = Pick<PrismaClient, "project" | "team">;

/** Project's `Project` and organization's `Team` rows, read through their shares (R40). */
export class PrismaInstantEvalJudgeProjectRepository extends InstantEvalJudgeProjectRepository {
  private constructor(private readonly prisma: PrismaInstantEvalJudgeProjectDatabase) {
    super();
  }

  static create({
    prisma,
  }: Readonly<{
    prisma: PrismaInstantEvalJudgeProjectDatabase;
  }>): PrismaInstantEvalJudgeProjectRepository {
    return new PrismaInstantEvalJudgeProjectRepository(prisma);
  }

  async getPlacement({
    projectId,
  }: {
    projectId: string;
  }): Promise<InstantEvalJudgeProjectPlacement> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { teamId: true },
    });
    if (!project) return { outcome: "unknown" };
    const team = await this.prisma.team.findUnique({
      where: { id: project.teamId },
      select: { organizationId: true },
    });
    return team
      ? { outcome: "known", organizationId: team.organizationId }
      : { outcome: "unknown" };
  }
}
