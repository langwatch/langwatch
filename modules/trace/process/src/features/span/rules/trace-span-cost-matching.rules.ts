import {
  estimateModelCost,
  getStaticModelCostRates,
  isModelCostUnpriced,
} from "@langwatch/model-provider-contract";
import type { NormalizedAttributes } from "@langwatch/trace-contract";

/**
 * Per-span cost by priority cascade: enrichment cost rates, then the span's explicit
 * `langwatch.span.cost`, then the static model registry, then guardrail cost. An explicit total
 * is the application's own figure, so it beats our token-times-registry estimate.
 */
export function computeSpanCost({
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

/** Whether the span's usage has no price in the cascade above, so a zero cost means unknown. */
export function isSpanCostUnpriced({
  attrs,
  model,
  promptTokens,
  completionTokens,
}: {
  attrs: NormalizedAttributes;
  model?: string;
  promptTokens: number | null;
  completionTokens: number | null;
}): boolean {
  return isModelCostUnpriced({
    input: { attrs, model, promptTokens, completionTokens },
    staticCosts: getStaticModelCostRates(),
  });
}
