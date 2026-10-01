import { findModelById, type CustomModelEntry } from "@langwatch/model-provider-contract";

export type ProviderWithCustomModels = {
  customModels?: CustomModelEntry[] | null;
};

/**
 * The completion-token ceiling a model may be called with: a custom model's own limit where the
 * project declared one, and the catalogue's otherwise.
 */
export function pickMaxTokensCeiling(
  modelId: string,
  modelProvider: ProviderWithCustomModels | null | undefined,
): number | undefined {
  const modelName = modelId.split("/").slice(1).join("/");
  const custom = modelProvider?.customModels?.find((entry) => entry.modelId === modelName);
  if (custom?.maxTokens && custom.maxTokens > 0) return custom.maxTokens;

  const model = findModelById(modelId)[0] ?? findModelById(modelName)[0];
  return model?.maxCompletionTokens ?? undefined;
}
