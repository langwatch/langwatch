import { PrismaRepository } from "@langwatch/prisma-client";
import { Temporal, toDate } from "@langwatch/time";

import type {
  InstantEvalJudgeSpendRepository,
  InstantEvalJudgeSpendRow,
  InstantEvalJudgeSpendWrite,
} from "../instant-eval-judge-spend.repository.ts";

/** The judge's spend rows over Postgres; every query names the organization. */
export class PrismaInstantEvalJudgeSpendRepository
  extends PrismaRepository.for("InstantEvalJudgeSpend")
  implements InstantEvalJudgeSpendRepository
{
  static readonly create = this.factory(
    (prisma) => new PrismaInstantEvalJudgeSpendRepository(prisma),
  );

  /** ON CONFLICT DO NOTHING on (organizationId, requestId): a row is never rewritten. */
  async create({
    organizationId,
    requestId,
    spendNanoUsd,
    occurredAtMs,
  }: InstantEvalJudgeSpendRow): Promise<InstantEvalJudgeSpendWrite> {
    const created = await this.prisma.instantEvalJudgeSpend.createMany({
      data: [
        {
          organizationId,
          requestId,
          spendNanoUsd,
          occurredAt: toDate(Temporal.Instant.fromEpochMilliseconds(occurredAtMs)),
        },
      ],
      skipDuplicates: true,
    });
    return { outcome: created.count > 0 ? "recorded" : "already_recorded" };
  }

  async getTotal({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ spendNanoUsd: bigint }> {
    const total = await this.prisma.instantEvalJudgeSpend.aggregate({
      where: { organizationId },
      _sum: { spendNanoUsd: true },
    });
    return { spendNanoUsd: total._sum.spendNanoUsd ?? 0n };
  }
}
