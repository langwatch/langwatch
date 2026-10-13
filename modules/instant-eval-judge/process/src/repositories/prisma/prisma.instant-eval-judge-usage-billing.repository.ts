import { PrismaRepository } from "@langwatch/prisma-client";
import { Temporal, toDate } from "@langwatch/time";

import type { InstantEvalJudgeUsageBillingFact } from "../../rules/instant-eval-judge-usage-billing.rules.ts";
import type {
  InstantEvalJudgeUsageBilling,
  InstantEvalJudgeUsageBillingRepository,
} from "../instant-eval-judge-usage-billing.repository.ts";

/**
 * The judge's usage-billing copy over Postgres; every query names the organization. The update's
 * condition is `usageBillingFactWins` in SQL, so two folds racing on one row cannot both land.
 */
export class PrismaInstantEvalJudgeUsageBillingRepository
  extends PrismaRepository.for("InstantEvalJudgeUsageBilling")
  implements InstantEvalJudgeUsageBillingRepository
{
  static readonly create = this.factory(
    (prisma) => new PrismaInstantEvalJudgeUsageBillingRepository(prisma),
  );

  async getUsageBilling({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<InstantEvalJudgeUsageBilling> {
    const row = await this.prisma.instantEvalJudgeUsageBilling.findUnique({
      where: { organizationId },
      select: { usageBilled: true, occurredAt: true, fromCatchUp: true },
    });
    if (!row) return { outcome: "never_folded" };
    return {
      outcome: "folded",
      fact: {
        usageBilled: row.usageBilled,
        occurredAtMs: row.occurredAt.getTime(),
        fromCatchUp: row.fromCatchUp,
      },
    };
  }

  async upsert({
    organizationId,
    usageBilled,
    occurredAtMs,
    fromCatchUp,
  }: { organizationId: string } & InstantEvalJudgeUsageBillingFact): Promise<void> {
    const occurredAt = toDate(Temporal.Instant.fromEpochMilliseconds(occurredAtMs));
    const fact = { usageBilled, occurredAt, fromCatchUp };
    const created = await this.prisma.instantEvalJudgeUsageBilling.createMany({
      data: [{ organizationId, ...fact }],
      skipDuplicates: true,
    });
    if (created.count > 0) return;
    await this.prisma.instantEvalJudgeUsageBilling.updateMany({
      where: {
        organizationId,
        OR: [
          { occurredAt: { lt: occurredAt } },
          // A tie goes to a real fact over a catch-up; never the other way.
          ...(fromCatchUp ? [] : [{ occurredAt, fromCatchUp: true }]),
        ],
      },
      data: fact,
    });
  }
}
