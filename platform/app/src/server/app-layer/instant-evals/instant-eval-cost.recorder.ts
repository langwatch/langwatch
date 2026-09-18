/**
 * What one query's judgements cost, recorded once.
 *
 * One row per query rather than one per judged row: a statement judging a
 * thousand conversations is one thing the customer asked for, and a thousand
 * cost rows would bury every other kind of cost in the same table. The row
 * carries our own cost as `amount` — the same meaning every other cost row in
 * this table has — and the customer's price beside it in `extraInfo`, so the
 * markup is recoverable without recomputing it from a rate that will change.
 *
 * Modelled on `../evaluations/evaluation-cost.recorder.ts`: a port with a
 * Prisma adapter, an explicit KSUID rather than the schema default, and
 * domain extras in `extraInfo`.
 *
 * @see ./classifier/pricing.ts
 */

import { generate } from "@langwatch/ksuid";

import {
  CostReferenceType,
  CostType,
  type PrismaClient,
} from "~/generated/prisma/client";
import { KSUID_RESOURCES } from "~/utils/constants";

/** What one query or one run spent on judgements. */
export interface InstantEvalCostRecord {
  readonly projectId: string;
  /** Input tokens the classifier billed for. */
  readonly inputTokens: number;
  /** Classifications made, which is one per judged text. */
  readonly requests: number;
  /** What the classifier charged us, in USD. */
  readonly costUsd: number;
  /** What the customer is charged, in USD. */
  readonly priceUsd: number;
  /**
   * The run this cost belongs to, when it belongs to one.
   *
   * A synchronous query has no durable resource to point at, so it leaves this
   * absent and the row points at the project. A run does have one, and naming
   * it is what lets "what did that run cost" be a query rather than a guess
   * from timestamps.
   */
  readonly runId?: string;
}

export interface InstantEvalCostRecorder {
  recordCost(record: InstantEvalCostRecord): Promise<string>;
}

/** Whether Prisma refused a write because the row already exists. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export class PrismaInstantEvalCostRecorder implements InstantEvalCostRecorder {
  constructor(private readonly prisma: PrismaClient) {}

  async recordCost(record: InstantEvalCostRecord): Promise<string> {
    // A run's cost row is addressed by the run, so a retried finish writes the
    // same row rather than a second one. That is what lets the finish intent
    // be retried at all: a plain create would double-bill a run whose first
    // attempt failed after the insert but before the acknowledgement.
    const costId = record.runId
      ? `${KSUID_RESOURCES.COST}_instanteval_${record.runId}`
      : generate(KSUID_RESOURCES.COST).toString();
    const data = {
      projectId: record.projectId,
      costType: CostType.INSTANT_EVAL,
      costName: record.runId ? "Instant Eval run" : "Instant Eval query",
      referenceType: CostReferenceType.INSTANT_EVAL,
      // The run when there is one, and otherwise the project: a synchronous
      // query has no durable resource to point at, and inventing an id per
      // request would index a column no query could ever join on.
      referenceId: record.runId ?? record.projectId,
      amount: record.costUsd,
      currency: "USD",
      extraInfo: {
        input_tokens: record.inputTokens,
        requests: record.requests,
        price_usd: record.priceUsd,
      },
    };

    try {
      await this.prisma.cost.create({ data: { id: costId, ...data } });
    } catch (error) {
      // A unique violation on the id means the row this call would have
      // written is already there, which is the whole point of addressing it by
      // the run: a retried finish lands on the same row instead of billing a
      // second time. Every other failure is real and belongs to the caller,
      // which retries the finish.
      if (!isUniqueViolation(error)) throw error;
    }
    return costId;
  }
}
