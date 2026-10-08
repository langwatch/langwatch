import { PrismaRepository } from "@langwatch/prisma-client";
import { Temporal, toDate } from "@langwatch/time";

import type {
  InstantEvalJudgeProjectPlacement,
  InstantEvalJudgeProjectRepository,
} from "../instant-eval-judge-project.repository.ts";

/** The judge's project to organization map over Postgres; every query names the project. */
export class PrismaInstantEvalJudgeProjectRepository
  extends PrismaRepository.for("InstantEvalJudgeProject")
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
    const row = await this.prisma.instantEvalJudgeProject.findUnique({
      where: { projectId },
      select: { organizationId: true },
    });
    return row ? { outcome: "known", organizationId: row.organizationId } : { outcome: "unknown" };
  }

  /** ON CONFLICT DO NOTHING: a repeated or concurrent fact leaves the first row standing. */
  async upsert({
    projectId,
    organizationId,
    createdAtMs,
  }: {
    projectId: string;
    organizationId: string;
    createdAtMs: number;
  }): Promise<void> {
    await this.prisma.instantEvalJudgeProject.createMany({
      data: [
        {
          projectId,
          organizationId,
          createdAt: toDate(Temporal.Instant.fromEpochMilliseconds(createdAtMs)),
        },
      ],
      skipDuplicates: true,
    });
  }
}
