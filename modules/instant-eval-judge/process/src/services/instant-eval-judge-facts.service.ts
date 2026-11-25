import type {
  InstantEvalJudgeLedgerSpend,
  InstantEvalJudgeLedgerSpendCopy,
} from "@langwatch/instant-eval-judge-contract";

import type {
  InstantEvalJudgeSpendRow,
  InstantEvalJudgeSpendWrite,
} from "../repositories/instant-eval-judge-spend.repository.ts";
import type { InstantEvalJudgeUsageBilling } from "../repositories/instant-eval-judge-usage-billing.repository.ts";
import type { InstantEvalJudgeRepositories } from "../repositories/instant-eval-judge.repositories.ts";

type InstantEvalJudgeFactRepositories = Pick<
  InstantEvalJudgeRepositories,
  "usageBilling" | "spend"
>;

/**
 * Folds billing's usage-billed fact and the judge's spend into its own tables, and reads them back
 * (ADR-174 decisions 13, 17); project placement is read through shares (R40). Every fold is safe
 * to repeat: a peer event is delivered at least once and never deduplicated for a subscriber.
 */
export class InstantEvalJudgeFactsService {
  private constructor(private readonly repositories: InstantEvalJudgeFactRepositories) {}

  static create({
    repositories,
  }: {
    repositories: InstantEvalJudgeFactRepositories;
  }): InstantEvalJudgeFactsService {
    return new InstantEvalJudgeFactsService(repositories);
  }

  /** Billing's usage-billing fact, real or catch-up; the newest stamp wins. */
  usageBillingChanged({
    organizationId,
    usageBilled,
    occurredAt,
    fromCatchUp,
  }: {
    organizationId: string;
    usageBilled: boolean;
    occurredAt: number;
    fromCatchUp: boolean;
  }): Promise<void> {
    return this.repositories.usageBilling.upsert({
      organizationId,
      usageBilled,
      occurredAtMs: occurredAt,
      fromCatchUp,
    });
  }

  /** One row per request; a request already recorded keeps its first row. */
  recordSpend(row: InstantEvalJudgeSpendRow): Promise<InstantEvalJudgeSpendWrite> {
    return this.repositories.spend.create(row);
  }

  /**
   * The spend catch-up's copy of one confirmed ledger row (ADR-174 decision 17). It goes straight
   * to the spend table, since the ledger already holds the row a priced fact would write.
   */
  async copyLedgerSpend({
    organizationId,
    requestId,
    spendNanoUsd,
    occurredAt,
  }: InstantEvalJudgeLedgerSpend): Promise<InstantEvalJudgeLedgerSpendCopy> {
    const { outcome } = await this.repositories.spend.create({
      organizationId,
      requestId,
      spendNanoUsd: BigInt(spendNanoUsd),
      occurredAtMs: occurredAt,
    });
    return { outcome: outcome === "recorded" ? "copied" : "already_held" };
  }

  getUsageBilling({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<InstantEvalJudgeUsageBilling> {
    return this.repositories.usageBilling.getUsageBilling({ organizationId });
  }

  getSpendTotal({ organizationId }: { organizationId: string }): Promise<{ spendNanoUsd: bigint }> {
    return this.repositories.spend.getTotal({ organizationId });
  }
}
