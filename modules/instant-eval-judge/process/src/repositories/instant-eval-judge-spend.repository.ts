/** One judge request's spend, in nano USD, as the judge records it. */
export type InstantEvalJudgeSpendRow = Readonly<{
  organizationId: string;
  requestId: string;
  spendNanoUsd: bigint;
  occurredAtMs: number;
}>;

/** Whether a spend row was written, or the request already had one. */
export type InstantEvalJudgeSpendWrite = Readonly<{ outcome: "recorded" | "already_recorded" }>;

/**
 * The judge's own spend, one row per organization and request, never rewritten (ADR-174
 * decision 13). The organization's total is the sum of its rows.
 */
export abstract class InstantEvalJudgeSpendRepository {
  /** A request that already has a row keeps it, whoever wrote it first. */
  abstract create(input: InstantEvalJudgeSpendRow): Promise<InstantEvalJudgeSpendWrite>;

  /** The sum of the organization's rows; zero when it has none. */
  abstract getTotal(input: { organizationId: string }): Promise<{ spendNanoUsd: bigint }>;
}
