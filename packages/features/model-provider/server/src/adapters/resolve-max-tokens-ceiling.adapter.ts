import { getModelById } from "@langwatch/model-provider-contract";
import type { CustomModelEntry } from "@langwatch/model-provider-contract";

type ProviderWithCustomModels = {
  customModels?: CustomModelEntry[] | null;
};

/** Resolve custom-model limits before falling back to the catalog. */
export function resolveMaxTokensCeiling(
  modelId: string,
  modelProvider: ProviderWithCustomModels | null | undefined,
): number | undefined {
  const modelName = modelId.split("/").slice(1).join("/");
  const custom = modelProvider?.customModels?.find((entry) => entry.modelId === modelName);
  if (custom?.maxTokens && custom.maxTokens > 0) return custom.maxTokens;

  const model = getModelById(modelId) ?? getModelById(modelName);
  return model?.maxCompletionTokens ?? undefined;
}
