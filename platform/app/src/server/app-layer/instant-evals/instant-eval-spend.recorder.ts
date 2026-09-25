/**
 * Where what a judged query or run spent is reported, recorded once per query
 * and once per run.
 *
 * One record per query rather than one per judged row: a statement judging a
 * thousand conversations is one thing the customer asked for. The record
 * carries our own cost and the customer's price beside it, so the markup is
 * recoverable without recomputing it from a rate that will change.
 *
 * A port, because the spend belongs to the gateway spend pipeline rather than
 * to this slice: the implementation that meters it against the customer's
 * budget binds here, and until it does the default only logs what would have
 * been metered.
 *
 * @see ./classifier/pricing.ts
 * @see ../../../../../specs/instant-evals/instant-eval-cost.feature
 */

import { createLogger } from "@langwatch/observability";

/** What one query or one run spent on judgements. */
export interface InstantEvalSpendRecord {
  readonly projectId: string;
  /**
   * The run this spend belongs to, when it belongs to one.
   *
   * A synchronous query has no durable resource to point at, so it leaves this
   * absent. A run does have one, and naming it is what lets "what did that run
   * cost" be a query rather than a guess from timestamps.
   */
  readonly runId?: string;
  /** The gateway key a hosted call was made under. Absent everywhere else. */
  readonly virtualKeyId?: string;
  /** Input tokens the classifier billed for. */
  readonly inputTokens: number;
  /** Classifications made, which is one per judged text. */
  readonly requests: number;
  /** What the classifier charged us, in USD. */
  readonly costUsd: number;
  /** What the customer is charged, in USD: the cost at the published markup. */
  readonly priceUsd: number;
  readonly occurredAt: Date;
}

export interface InstantEvalSpendRecorder {
  recordSpend(record: InstantEvalSpendRecord): Promise<void>;
}

const logger = createLogger("langwatch:instant-evals:spend");

/**
 * The default binding: the spend is logged and nothing is metered.
 *
 * What a deployment gets until the gateway spend pipeline binds its own
 * recorder here. Logged at info rather than debug because it is the only
 * record the spend leaves.
 */
export class LoggingInstantEvalSpendRecorder
  implements InstantEvalSpendRecorder
{
  async recordSpend(record: InstantEvalSpendRecord): Promise<void> {
    logger.info(
      {
        projectId: record.projectId,
        runId: record.runId ?? null,
        inputTokens: record.inputTokens,
        requests: record.requests,
        costUsd: record.costUsd,
        priceUsd: record.priceUsd,
        occurredAt: record.occurredAt.toISOString(),
      },
      "Instant Evals spend recorded",
    );
  }
}
