import { estimateModelCost, getStaticModelCostRates } from "@langwatch/model-provider-contract";
import type { NormalizedAttributes } from "@langwatch/trace-contract";

export class TraceSpanCostMatchingService {
  static create(): TraceSpanCostMatchingService {
    return new TraceSpanCostMatchingService();
  }

  /**
   * Computes per-span cost via a priority cascade: (1) custom cost rates from enrichment attributes, (2) explicit total cost reported on the span (`langwatch.span.cost`), (3) static model registry lookup (provider subtype + date fallbacks), (4) guardrail cost extraction. An explicit cost is a figure the instrumented application worked out itself via the SDK's metrics.cost, so it wins over our token × registry ESTIMATE — the registry is the fallback for when nobody told us the cost, not an override of a known-good one; per-token enrichment rates still rank first as a deliberate "price everything my way" policy, more specific than a single span's total. Priorities 2 and 4 pass through an already-computed total; 1 and 3 both run the same `estimateCost` arithmetic, so a new billable unit costs the same whether the rates came from a customer override or the registry.
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
