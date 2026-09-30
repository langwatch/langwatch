/**
 * What a run would read, and what judging it would cost, without judging any
 * of it.
 *
 * A separate module from the service because it is the only operation that has
 * to model the run rather than perform it: the count bounds the rows, a sample
 * of texts measures what one row sends, and the classifier's own published
 * rate turns that into a price. The service holds the surface; the arithmetic
 * lives here.
 *
 * @see ../classifier/pricing.ts
 * @see ./caps.ts
 * @see ../../../../../specs/instant-evals/instant-eval-api.feature
 */

import { createLogger } from "@langwatch/observability";

import type { Protections } from "~/server/traces/protections";
import type { InstantEvalClassifier } from "../classifier/classifier";
import { instantEvalCostUsd, instantEvalPriceUsd } from "../classifier/pricing";
import { estimateInstantEvalRequestTokens } from "../classifier/token-budget";
import {
  InstantEvalEstimateUnavailableError,
  InstantEvalRowCapExceededError,
} from "./errors";
import { instantEvalAverageTextBytes } from "./instant-eval-run.sizing";
import type { InstantEvalRowSource, InstantEvalRunCaller } from "./row-source";
import type { AcceptedInstantEvalStatement } from "./statement";

const logger = createLogger("langwatch:instant-evals:estimate");

/** Rows an estimate measures the text size of. */
export const INSTANT_EVAL_ESTIMATE_SAMPLE = 50;

/** What a run would read, and what judging it would cost. */
export interface InstantEvalEstimate {
  /** Rows the statement matches, bounded by the run's own limit. */
  readonly rows: number;
  /** Whether the statement matched more rows than the run may judge. */
  readonly isRowsCapped: boolean;
  /** Input tokens one judged row sends, measured from a sample. */
  readonly avgTokens: number;
  readonly totalTokens: number;
  /** Classifications the run would make, one per judged row. */
  readonly requests: number;
  readonly costUsd: number;
  readonly priceUsd: number;
  /**
   * What is left of the free budget, for an organization without a paid plan.
   * Absent for a paid organization, which has no such budget.
   */
  readonly freeBudgetRemainingUsd?: number;
}

export async function estimateInstantEvalRun({
  projectId,
  protections,
  caller,
  accepted,
  rowLimit,
  rowSource,
  classifier,
}: {
  projectId: string;
  protections: Protections;
  caller: InstantEvalRunCaller;
  accepted: AcceptedInstantEvalStatement;
  rowLimit: number;
  rowSource: InstantEvalRowSource;
  classifier: InstantEvalClassifier;
}): Promise<InstantEvalEstimate> {
  try {
    const { total, sample } = await sampleSelection({
      protections,
      caller,
      accepted,
      rowLimit,
      rowSource,
    });
    return priceSample({ total, sample, accepted, rowLimit, classifier });
  } catch (error) {
    if (error instanceof InstantEvalRowCapExceededError) throw error;
    logger.error({ projectId, error }, "Instant Eval estimate failed");
    throw new InstantEvalEstimateUnavailableError({
      reasons: [error instanceof Error ? error : new Error(String(error))],
    });
  }
}

/** How many rows the statement matches, and the texts of a sample of them. */
async function sampleSelection({
  protections,
  caller,
  accepted,
  rowLimit,
  rowSource,
}: {
  protections: Protections;
  caller: InstantEvalRunCaller;
  accepted: AcceptedInstantEvalStatement;
  rowLimit: number;
  rowSource: InstantEvalRowSource;
}): Promise<{
  total: number;
  sample: readonly Record<string, unknown>[];
}> {
  // A count rather than a read of every key: a hundred thousand keys is past
  // the executor's byte ceiling, and that ceiling truncates silently, so the
  // price a caller reads before spending would be the price of a smaller run
  // than the one they are about to start.
  const total = await rowSource.count({
    caller,
    sql: accepted.sql,
    parameters: accepted.parameters,
    limit: rowLimit + 1,
  });
  if (total === 0) return { total, sample: [] };

  // Spread across the whole selection, not its first rows. A statement's own
  // order correlates with row length on real data, so the first fifty rows
  // of a ten thousand row selection measured 231 tokens against its true
  // 1,138 and the price came out five times low.
  const sampled = await rowSource.sampleKeys({
    caller,
    sql: accepted.sql,
    parameters: accepted.parameters,
    keyColumns: accepted.keyColumns,
    limit: INSTANT_EVAL_ESTIMATE_SAMPLE,
    total,
  });
  const traceIds = [...new Set(sampled.map((key) => key.traceId))];
  if (traceIds.length === 0) return { total, sample: [] };

  const sample = await rowSource.texts({
    caller,
    protections,
    sql: accepted.sql,
    parameters: accepted.parameters,
    calls: accepted.plan,
    traceIds,
  });
  return { total, sample };
}

/** What judging every matched row would send, and cost, from the sample. */
function priceSample({
  total,
  sample,
  accepted,
  rowLimit,
  classifier,
}: {
  total: number;
  sample: readonly Record<string, unknown>[];
  accepted: AcceptedInstantEvalStatement;
  rowLimit: number;
  classifier: InstantEvalClassifier;
}): InstantEvalEstimate {
  const averageBytes = instantEvalAverageTextBytes({
    rows: sample,
    questionIds: accepted.questions.map((question) => question.id),
  });
  // Priced at what one request of the average text would send, because one
  // request carries every question about one text: that is the whole reason a
  // three-question statement costs about what a one-question one does.
  const avgTokens = estimateInstantEvalRequestTokens({
    text: "x".repeat(averageBytes),
    questions: accepted.questions.map((question) => question.question),
    limits: classifier.limits,
  });
  const rows = Math.min(total, rowLimit);
  const totalTokens = avgTokens * rows;
  const costUsd = instantEvalCostUsd({
    inputTokens: totalTokens,
    pricing: classifier.pricing,
  });
  return {
    rows,
    isRowsCapped: total > rowLimit,
    avgTokens,
    totalTokens,
    requests: rows,
    costUsd,
    priceUsd: instantEvalPriceUsd({ costUsd, pricing: classifier.pricing }),
  };
}
