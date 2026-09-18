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

/** What one query spent on judgements. */
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
}

export interface InstantEvalCostRecorder {
  recordCost(record: InstantEvalCostRecord): Promise<string>;
}

export class PrismaInstantEvalCostRecorder implements InstantEvalCostRecorder {
  constructor(private readonly prisma: PrismaClient) {}

  async recordCost(record: InstantEvalCostRecord): Promise<string> {
    const costId = generate(KSUID_RESOURCES.COST).toString();
    await this.prisma.cost.create({
      data: {
        id: costId,
        projectId: record.projectId,
        costType: CostType.INSTANT_EVAL,
        costName: "Instant Eval query",
        referenceType: CostReferenceType.INSTANT_EVAL,
        // The project itself: a synchronous query has no durable resource to
        // point at, and inventing an id per request would index a column no
        // query could ever join on.
        referenceId: record.projectId,
        amount: record.costUsd,
        currency: "USD",
        extraInfo: {
          input_tokens: record.inputTokens,
          requests: record.requests,
          price_usd: record.priceUsd,
        },
      },
    });
    return costId;
  }
}
