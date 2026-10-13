import { ATTR_KEYS } from "@langwatch/span-normalisation";

import { NormalizedStatusCode, type NormalizedSpan } from "../../trace.spans.ts";
import {
  extractSpanCacheTokens,
  extractSpanModels,
  extractSpanTokenCounts,
  isSpanCostNonBillable,
  isSpanTokenAccumulationSkipped,
} from "./span-cost-metrics.ts";

/** One span's additive contribution to the per-minute analytics rollup. */
export interface SpanRollupContribution {
  /** Response model > request model > ''. A sort key: the span's own model. */
  model: string;
  /** langwatch.span.type ('' when absent). */
  spanType: string;
  /** Always 1. */
  spanCount: number;
  /** 1 on the root span, else 0. */
  traceCount: number;
  /** 1 on an erroring root span, else 0. */
  errorCount: number;
  costSum: number;
  /** The span's own cost when it is non-billable, else 0. */
  nonBilledCostSum: number;
  /** Root carries the trace wall-clock duration, children 0. */
  durationSum: number;
  promptTokensSum: number;
  completionTokensSum: number;
  cacheReadTokensSum: number;
  cacheWriteTokensSum: number;
  reasoningTokensSum: number;
}

/**
 * The same extractions the trace-summary fold makes, so a bucket sums to the
 * trace total. `spanCost` is the span's price, looked up by the caller; a
 * redundant usage-copy span contributes no tokens and no cost.
 */
export function deriveSpanRollupContribution({
  span,
  spanCost,
}: {
  span: NormalizedSpan;
  spanCost: number;
}): SpanRollupContribution {
  const isRoot = span.parentSpanId === null;
  const isError = isRoot && span.statusCode === NormalizedStatusCode.ERROR;
  const spanType = span.spanAttributes[ATTR_KEYS.SPAN_TYPE];
  const skipped = isSpanTokenAccumulationSkipped(span);
  const tokens = skipped
    ? { promptTokens: 0, completionTokens: 0, cost: 0 }
    : { ...extractSpanTokenCounts(span), cost: spanCost };
  const cacheTokens = skipped
    ? { cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0 }
    : extractSpanCacheTokens(span);

  return {
    model: extractSpanModels(span)[0] ?? "",
    spanType: typeof spanType === "string" ? spanType : "",
    spanCount: 1,
    traceCount: isRoot ? 1 : 0,
    errorCount: isError ? 1 : 0,
    costSum: tokens.cost,
    nonBilledCostSum: isSpanCostNonBillable(span) ? tokens.cost : 0,
    durationSum: isRoot ? Math.round(span.durationMs) : 0,
    promptTokensSum: tokens.promptTokens,
    completionTokensSum: tokens.completionTokens,
    cacheReadTokensSum: cacheTokens.cacheReadTokens,
    cacheWriteTokensSum: cacheTokens.cacheCreationTokens,
    reasoningTokensSum: cacheTokens.reasoningTokens,
  };
}
