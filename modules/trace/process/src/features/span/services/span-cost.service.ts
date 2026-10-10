import {
  accumulateSpanTokens,
  deriveSpanPriceInput,
  deriveSpanStorageCost,
  extractSpanCacheTokens,
  extractSpanModels,
  extractSpanTokenCounts,
  extractSpanTokenTiming,
  isSpanCostNonBillable,
  isSpanTokenAccumulationSkipped,
} from "@langwatch/trace-contract";
import type {
  NormalizedSpan,
  SpanCacheTokens,
  SpanTokenAccumulation,
  SpanTokenTiming,
  TraceSummaryData,
} from "@langwatch/trace-contract";

import type { TraceModelCost } from "../../derivation/services/trace-model-cost.service.ts";

/**
 * Prices a span from the model catalogue and hands the price to
 * trace-contract's pure span-cost functions, which do the rest.
 */
export class SpanCostService {
  private constructor(private readonly modelCosts: TraceModelCost) {}

  static create(options: { modelCosts: TraceModelCost }): SpanCostService {
    return new SpanCostService(options.modelCosts);
  }

  /** The price a span adds to the trace's running cost: none when it skips token accumulation. */
  estimateAccumulatedSpanCost(span: NormalizedSpan): number {
    return isSpanTokenAccumulationSkipped(span) ? 0 : this.estimateSpanCost(span);
  }

  /** The span's own cost (USD) from its token counts, model and any custom rates it carries. */
  estimateSpanCost(span: NormalizedSpan): number {
    return this.modelCosts.estimate(deriveSpanPriceInput(span));
  }

  extractModelsFromSpan(span: NormalizedSpan): string[] {
    return extractSpanModels(span);
  }

  extractTokenMetrics(span: NormalizedSpan): {
    promptTokens: number;
    completionTokens: number;
    cost: number;
    estimated: boolean;
  } {
    const counts = extractSpanTokenCounts(span);

    return {
      promptTokens: counts.promptTokens,
      completionTokens: counts.completionTokens,
      cost: this.estimateSpanCost(span),
      estimated: counts.estimated,
    };
  }

  extractCacheTokens(span: NormalizedSpan): SpanCacheTokens {
    return extractSpanCacheTokens(span);
  }

  isSpanCostNonBillable(span: NormalizedSpan): boolean {
    return isSpanCostNonBillable(span);
  }

  deriveStorageCost(span: NormalizedSpan): {
    cost: number | null;
    nonBilledCost: number | null;
  } {
    return deriveSpanStorageCost({ span, spanCost: this.estimateSpanCost(span) });
  }

  isTokenAccumulationSkipped(span: NormalizedSpan): boolean {
    return isSpanTokenAccumulationSkipped(span);
  }

  extractTokenTiming(span: NormalizedSpan): SpanTokenTiming {
    return extractSpanTokenTiming(span);
  }

  accumulateTokens({
    state,
    span,
    totalDurationMs,
  }: {
    state: TraceSummaryData;
    span: NormalizedSpan;
    totalDurationMs: number;
  }): SpanTokenAccumulation {
    const spanCost = this.estimateAccumulatedSpanCost(span);

    return accumulateSpanTokens({ state, span, spanCost, totalDurationMs });
  }
}
