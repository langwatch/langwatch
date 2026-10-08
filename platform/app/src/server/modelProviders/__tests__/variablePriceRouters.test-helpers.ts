/**
 * Shared catalog reading for the tests that guard variable-price routers.
 *
 * A router picks another model per request, so it has no rate of its own.
 * The upstream source marks that with a rate of -1 per token, whatever the
 * vendor prefix. The cost registry, the gateway spend rating, the trace span
 * cost and the evaluation cell cost are each guarded against such a rate, and
 * every one of those tests takes its list of routers from here, so a router
 * a later sync adds is covered everywhere at once.
 */
import type { LLMModelEntry } from "../llmModels.types";
import { llmModels } from "../loadModelCatalog";

/**
 * Whether a catalog entry is a router: it states at least one rate, and every
 * rate it states is negative. An entry with a single negative field next to
 * real prices is not a router; it is a bad price and has to be explained on
 * its own.
 */
export const isVariablePriceRouter = (entry: LLMModelEntry | undefined) => {
  const rates = Object.values(entry?.pricing ?? {}).filter(
    (rate): rate is number => typeof rate === "number",
  );
  return rates.length > 0 && rates.every((rate) => rate < 0);
};

/** Every model id the merged catalog prices as a router. */
export const VARIABLE_PRICE_ROUTERS = Object.entries(llmModels.models)
  .filter(([, entry]) => isVariablePriceRouter(entry))
  .map(([modelId]) => modelId)
  .sort();
