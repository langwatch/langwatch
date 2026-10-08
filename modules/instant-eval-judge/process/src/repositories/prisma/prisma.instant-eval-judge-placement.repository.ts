import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  InstantEvalJudgeProjectPlacement,
  InstantEvalJudgeProjectRepository,
} from "../instant-eval-judge-placement.repository.ts";

/** Only the shared delegates this reader touches; it claims no table (R40). */
type InstantEvalJudgePlacementDatabase = Pick<PrismaClient, "project" | "team">;

/** Project's `Project` row and its team's organization, through their shares. */
export class PrismaInstantEvalJudgeProjectRepository implements InstantEvalJudgeProjectRepository {
  static create({
    prisma,
  }: {
    prisma: InstantEvalJudgePlacementDatabase;
  }): PrismaInstantEvalJudgeProjectRepository {
    return new PrismaInstantEvalJudgeProjectRepository(prisma);
  }

  private constructor(private readonly prisma: InstantEvalJudgePlacementDatabase) {}

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
