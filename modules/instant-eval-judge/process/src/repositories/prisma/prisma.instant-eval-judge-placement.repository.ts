import { PrismaRepository } from "@langwatch/prisma-client";

import type {
  InstantEvalJudgeProjectPlacement,
  InstantEvalJudgeProjectRepository,
} from "../instant-eval-judge-placement.repository.ts";

/** Project's `Project` and organization's `Team` rows, read through their shares (R40). */
export class PrismaInstantEvalJudgeProjectRepository
  extends PrismaRepository.for("Project", "Team")
  implements InstantEvalJudgeProjectRepository
{
  static readonly create = this.factory(
    (prisma) => new PrismaInstantEvalJudgeProjectRepository(prisma),
  );

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
