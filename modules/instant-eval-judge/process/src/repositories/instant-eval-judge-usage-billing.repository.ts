import type { InstantEvalJudgeUsageBillingFact } from "../rules/instant-eval-judge-usage-billing.rules.ts";

/** The usage-billing fact the judge holds for an organization, or that it holds none yet. */
export type InstantEvalJudgeUsageBilling =
  | Readonly<{ outcome: "folded"; fact: InstantEvalJudgeUsageBillingFact }>
  | Readonly<{ outcome: "never_folded" }>;

/**
 * The judge's copy of whether the meter bills each organization, folded from billing's
 * usage-billing fact and its catch-up (ADR-174 decision 17). One row per organization.
 */
export abstract class InstantEvalJudgeUsageBillingRepository {
  /** Never folded is an answer: the organization reads as not usage billed until a fact lands. */
  abstract getUsageBilling(input: {
    organizationId: string;
  }): Promise<InstantEvalJudgeUsageBilling>;

  /** Keeps the fact only if it wins over the held one (`usageBillingFactWins`), atomically. */
  abstract upsert(
    input: { organizationId: string } & InstantEvalJudgeUsageBillingFact,
  ): Promise<void>;
}
