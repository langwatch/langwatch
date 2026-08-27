import { estimateModelCost } from "@langwatch/model-provider-contract";
import type { NormalizedAttributes } from "@langwatch/trace-contract";
import { getStaticModelCosts } from "~/server/modelProviders/llmModelCost";

/**
 * Computes per-span cost using a priority cascade:
 * 1. Custom cost rates from enrichment attributes (per-token override policy)
 * 2. Explicit total cost reported on the span (langwatch.span.cost)
 * 3. Static model registry lookup (with provider subtype + date fallbacks)
 * 4. Guardrail cost extraction
 *
 * An explicit cost is a figure the instrumented application worked out
 * itself and handed us through the SDK's metrics.cost, so it wins over our
 * token x registry ESTIMATE. The registry is the fallback for when nobody
 * told us the cost, not an override of a known-good one. (Per-token
 * enrichment rates still rank first: they are a deliberate "price
 * everything my way" policy, more specific than a single span's total.)
 *
 * Priorities 2 and 4 pass through a total someone else already worked out.
 * The two that price from rates, 1 and 3, both run the same `estimateCost`
 * arithmetic, so a new billable unit costs the same whether the rates came
 * from a customer override or the registry.
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
  return estimateModelCost({ attrs, model, promptTokens, completionTokens }, getStaticModelCosts());
}
