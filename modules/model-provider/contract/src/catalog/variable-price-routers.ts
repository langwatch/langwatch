/**
 * Routers pick a model per request, so they have no price of their own. The upstream sources
 * mark that with a negative rate (-1 per token). Read as a rate it bills a refund, so every
 * reader of catalog prices goes through these instead of the raw fields.
 */
import { llmModels } from "./model-catalog.ts";
import type { LLMModelPricing } from "./model-catalog.types.ts";

/**
 * What a router's input and output rates are written as. The schema needs a number there, so the
 * catalog keeps one marker value that `isVariablePriceRouter` reads and every cost reader drops.
 */
export const VARIABLE_PRICE_MARKER = -1;

/** The pricing with every negative rate dropped: a negative rate means "no price". */
export function withoutNegativeRates(pricing: LLMModelPricing): Partial<LLMModelPricing> {
  return Object.fromEntries(
    Object.entries(pricing).filter(([, rate]) => typeof rate === "number" && rate >= 0),
  ) as Partial<LLMModelPricing>;
}

/** True when every rate the entry states is negative: a router, priced by what it routes to. */
export function isVariablePriceRouter({ pricing }: { pricing: LLMModelPricing }): boolean {
  const rates = Object.values(pricing).filter((rate) => typeof rate === "number");
  return rates.length > 0 && rates.every((rate) => rate < 0);
}

let routerIds: ReadonlySet<string> | null = null;

/** True when the catalog lists this id as a router, in any letter case. */
export function isVariablePriceRouterId(modelId: string): boolean {
  routerIds ??= new Set(
    Object.entries(llmModels.models)
      .filter(([, entry]) => isVariablePriceRouter(entry))
      .map(([id]) => id.toLowerCase()),
  );
  return routerIds.has(modelId.toLowerCase());
}
