import type { ModelMetadataForFrontend } from "../../hooks/useModelProvidersSettings";

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
 * Models eligible as comparison reference: chat models with complete
 * catalog pricing. Models without pricing cannot produce an estimate, so
 * offering them would only lead to an empty result.
 */
export function referenceModelOptions(
  modelMetadata: Record<string, ModelMetadataForFrontend> | undefined,
): string[] {
  if (!modelMetadata) return [];
  return Object.entries(modelMetadata)
    .filter(([, metadata]) => {
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
