import {
  findMatchingModelCost,
  type ModelCost,
  type ModelCostRate,
} from "@langwatch/model-provider-contract";

/**
 * A project's stored cost rules as catalogue rates. A stored rule leaves an unset rate null and
 * the rate shape leaves it absent: the same fact, and a null read as a rate prices at zero.
 */
export function modelCostRatesOf(costs: readonly ModelCost[]): ModelCostRate[] {
  return costs.map((cost) => ({
    model: cost.model,
    regex: cost.regex,
    inputCostPerToken: cost.inputCostPerToken ?? undefined,
    outputCostPerToken: cost.outputCostPerToken ?? undefined,
    cacheReadCostPerToken: cost.cacheReadCostPerToken ?? undefined,
    cacheCreationCostPerToken: cost.cacheCreationCostPerToken ?? undefined,
    cacheCreation1hCostPerToken: cost.cacheCreation1hCostPerToken ?? undefined,
  }));
}

/** The project's own rate for a model, as the attributes the price cascade reads. */
export function customRateAttributesOf({
  model,
  rates,
}: {
  model: string;
  rates: readonly ModelCostRate[];
}): Record<string, number> {
  const [matched] = findMatchingModelCost(model, rates);
  if (!matched) return {};

  return {
    "langwatch.model.inputCostPerToken": matched.inputCostPerToken ?? 0,
    "langwatch.model.outputCostPerToken": matched.outputCostPerToken ?? 0,
    ...(matched.cacheReadCostPerToken == null
      ? {}
      : { "langwatch.model.cacheReadCostPerToken": matched.cacheReadCostPerToken }),
    ...(matched.cacheCreationCostPerToken == null
      ? {}
      : { "langwatch.model.cacheCreationCostPerToken": matched.cacheCreationCostPerToken }),
    ...(matched.cacheCreation1hCostPerToken == null
      ? {}
      : { "langwatch.model.cacheCreation1hCostPerToken": matched.cacheCreation1hCostPerToken }),
  };
}
