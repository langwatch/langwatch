import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  InstantEvalJudgeProjectPlacement,
  InstantEvalJudgeProjectRepository,
} from "../instant-eval-judge-placement.repository.ts";

/** Only the shared delegate this reader touches; it claims no table (R40). */
type InstantEvalJudgePlacementDatabase = Pick<PrismaClient, "project">;

/** Project's `Project` row and its team's organization, through their shares, in one read. */
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
      select: { team: { select: { organizationId: true } } },
    });
    return project?.team
      ? { outcome: "known", organizationId: project.team.organizationId }
      : { outcome: "unknown" };
  }
}
