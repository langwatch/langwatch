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

let catalogRouterIds: readonly string[] | null = null;
let routerIds: ReadonlySet<string> | null = null;

/** The ids of every router in the catalog, as the catalog writes them. */
export function getVariablePriceRouterIds(): readonly string[] {
  catalogRouterIds ??= Object.entries(llmModels.models)
    .filter(([, entry]) => isVariablePriceRouter(entry))
    .map(([id]) => id);
  return catalogRouterIds;
}

export type RouterMatch = { kind: "router"; routerId: string } | { kind: "not-router" };

/**
 * Which catalog router, if any, a model string names (its id in lower case). Takes the spellings
 * clients send: any letter case, extra leading segments (LiteLLM's `openrouter/openrouter/auto`)
 * and a `:variant` tag. A bare name with no provider is not read as a router.
 */
export function matchVariablePriceRouter(modelId: string): RouterMatch {
  routerIds ??= new Set(getVariablePriceRouterIds().map((id) => id.toLowerCase()));
  const segments = modelId.toLowerCase().split("/");
  const last = segments.length - 1;
  const tag = segments[last]!.indexOf(":");
  if (tag >= 0) segments[last] = segments[last]!.slice(0, tag);
  for (let start = 0; start < segments.length - 1; start++) {
    const candidate = segments.slice(start).join("/");
    if (routerIds.has(candidate)) return { kind: "router", routerId: candidate };
  }
  return { kind: "not-router" };
}

/** True when the model string names a catalog router, in any of the spellings above. */
export function isVariablePriceRouterId(modelId: string): boolean {
  return matchVariablePriceRouter(modelId).kind === "router";
}
