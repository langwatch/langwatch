import type { ModelMetadataForFrontend } from "../../hooks/useModelProvidersSettings";

export type ReferencePricing = {
  inputCostPerToken?: number;
  outputCostPerToken?: number;
  inputCacheReadPerToken?: number;
  inputCacheWritePerToken?: number;
} | null;

/**
 * The period's token counts, split the same way the product records them:
 * `promptTokens` is the fresh (non-cached) input, with the cached buckets
 * counted separately and never folded back into it. Pricing each bucket at its
 * own rate is the only way the estimate compares like with like against the
 * recorded cost, which is billed the same way.
 */
export type PeriodTokenTotals = {
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/**
 * Whether the catalog publishes enough of a price for this model to reprice a
 * period with it. Both per-token rates must be present and at least one must be
 * above zero, the same bar the recorded cost applies before it prices a call.
 * An all-zero row stands for "no published price" (self-hosted and custom
 * models carry one, and so do a handful of catalog entries whose price is not
 * public), so treating it as free would turn a missing price into a confident
 * $0 comparison.
 */
export function hasUsableReferencePricing(
  pricing: ReferencePricing | undefined,
): boolean {
  if (!pricing) return false;
  const { inputCostPerToken, outputCostPerToken } = pricing;
  if (
    typeof inputCostPerToken !== "number" ||
    typeof outputCostPerToken !== "number"
  ) {
    return false;
  }
  return inputCostPerToken > 0 || outputCostPerToken > 0;
}

/**
 * Cost of running the period's traffic on a reference model: the period's real
 * token counts priced at the reference model's per-token rates, one rate per
 * bucket. Cached input is priced at the model's cache rates, falling back to
 * the plain input rate when the catalog publishes none, so a cached prompt is
 * neither dropped from the estimate nor priced as if it were fresh.
 *
 * Returns undefined when the model has no usable price. A partial estimate
 * (input priced, output free) or a $0 one reads as a real number and there is
 * nothing on screen to tell the reader it is not.
 */
export function estimateReferenceCost({
  promptTokens,
  completionTokens,
  cacheReadTokens,
  cacheWriteTokens,
  pricing,
}: PeriodTokenTotals & {
  pricing: ReferencePricing | undefined;
}): number | undefined {
  if (!pricing || !hasUsableReferencePricing(pricing)) return undefined;
  const inputRate = pricing.inputCostPerToken ?? 0;
  const outputRate = pricing.outputCostPerToken ?? 0;
  const cacheReadRate = pricing.inputCacheReadPerToken ?? inputRate;
  const cacheWriteRate = pricing.inputCacheWritePerToken ?? inputRate;

  return (
    promptTokens * inputRate +
    completionTokens * outputRate +
    cacheReadTokens * cacheReadRate +
    cacheWriteTokens * cacheWriteRate
  );
}

/**
 * Models eligible as a comparison reference: the ones the catalog publishes a
 * real price for. Everything else, including custom and self-hosted models
 * whose real cost only the customer knows, is left out rather than offered as a
 * reference that would price the period at zero. Mode filtering (chat vs
 * embedding) is the ModelSelector's job, this list is pricing-only.
 */
export function referenceModelOptions({
  modelMetadata,
}: {
  modelMetadata: Record<string, ModelMetadataForFrontend> | undefined;
}): string[] {
  if (!modelMetadata) return [];
  return Object.entries(modelMetadata)
    .filter(([, metadata]) => hasUsableReferencePricing(metadata.pricing))
    .map(([id]) => id)
    .sort();
}
