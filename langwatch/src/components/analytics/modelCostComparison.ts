import type { ModelMetadataForFrontend } from "../../hooks/useModelProvidersSettings";
import type { MaybeStoredModelProvider } from "../../server/modelProviders/registry";

export type ReferencePricing = {
  inputCostPerToken?: number;
  outputCostPerToken?: number;
} | null;

/**
 * Cost of running the period's traffic on a reference model: the period's
 * real token counts priced at the reference model's per-token rates.
 * Returns undefined when the pricing is incomplete — a partial estimate
 * (input priced, output free) would understate the comparison and read as
 * a smaller-than-real saving.
 */
export function estimateReferenceCost({
  promptTokens,
  completionTokens,
  pricing,
}: {
  promptTokens: number;
  completionTokens: number;
  pricing: ReferencePricing | undefined;
}): number | undefined {
  if (
    !pricing ||
    typeof pricing.inputCostPerToken !== "number" ||
    typeof pricing.outputCostPerToken !== "number"
  ) {
    return undefined;
  }
  return (
    promptTokens * pricing.inputCostPerToken +
    completionTokens * pricing.outputCostPerToken
  );
}

/**
 * Full ids (`{providerKey}/{modelId}`) of user-defined custom/self-hosted
 * models. `mergeCustomModelMetadata` backfills these with a placeholder
 * `{0,0}` pricing so cost-suppression callers (e.g. LLMConfigPopover) don't
 * choke on missing fields — it is not real catalog pricing, so it must not
 * be trusted for a savings estimate.
 */
function customModelIds(
  providers: Record<string, MaybeStoredModelProvider> | undefined,
): Set<string> {
  const ids = new Set<string>();
  if (!providers) return ids;
  for (const [providerKey, config] of Object.entries(providers)) {
    for (const entry of [
      ...(config.customModels ?? []),
      ...(config.customEmbeddingsModels ?? []),
    ]) {
      ids.add(`${providerKey}/${entry.modelId}`);
    }
  }
  return ids;
}

/**
 * Models eligible as comparison reference: catalog models with complete
 * pricing. Models without pricing cannot produce an estimate, so offering
 * them would only lead to an empty result. Custom/self-hosted models are
 * excluded even though they carry placeholder pricing (see
 * `customModelIds`) — their real cost is unknown, so using them as a
 * reference would fabricate a savings number. Mode filtering (chat vs
 * embedding) is the ModelSelector's job — this list is pricing-only.
 */
export function referenceModelOptions({
  modelMetadata,
  providers,
}: {
  modelMetadata: Record<string, ModelMetadataForFrontend> | undefined;
  providers?: Record<string, MaybeStoredModelProvider> | undefined;
}): string[] {
  if (!modelMetadata) return [];
  const excluded = customModelIds(providers);
  return Object.entries(modelMetadata)
    .filter(([id, metadata]) => {
      if (excluded.has(id)) return false;
      const pricing = metadata.pricing;
      return (
        !!pricing &&
        typeof pricing.inputCostPerToken === "number" &&
        typeof pricing.outputCostPerToken === "number"
      );
    })
    .map(([id]) => id)
    .sort();
}
