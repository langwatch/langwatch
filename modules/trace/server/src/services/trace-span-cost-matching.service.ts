import { estimateModelCost, getStaticModelCostRates } from "@langwatch/model-provider-contract";
import type { NormalizedAttributes } from "@langwatch/trace-contract";

export class TraceSpanCostMatchingService {
  static create(): TraceSpanCostMatchingService {
    return new TraceSpanCostMatchingService();
  }

  /**
   * Per-span cost by priority cascade: enrichment cost rates, then the span's explicit
   * `langwatch.span.cost`, then the static model registry, then guardrail cost. An explicit total
   * is the application's own figure, so it beats our token-times-registry estimate.
   */
  static computeSpanCost({
    attrs,
    model,
    promptTokens,
    completionTokens,
  }: {
    attrs: NormalizedAttributes;
    model?: string;
    promptTokens: number | null;
    completionTokens: number | null;
  }): number {
    return estimateModelCost(
      { attrs, model, promptTokens, completionTokens },
      getStaticModelCostRates(),
    );
  }
}
