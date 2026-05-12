import { getModelLimits } from "../../utils/modelLimits";
import type { CustomModelEntry } from "./customModel.schema";

type ProviderWithCustomModels = {
  customModels?: CustomModelEntry[] | null;
};

/**
 * Resolve the configured max-tokens ceiling for a fully-qualified model id
 * (e.g. "openai/gpt-5"). Custom-model overrides win over the registry default.
 *
 * Returns undefined when no ceiling is known — callers should treat that as
 * "do not clamp" rather than fabricating a bound.
 */
export function resolveMaxTokensCeiling(
  modelId: string,
  modelProvider: ProviderWithCustomModels | null | undefined,
): number | undefined {
  const modelName = modelId.split("/").slice(1).join("/");
  const custom = modelProvider?.customModels?.find(
    (entry) => entry.modelId === modelName,
  );
  if (custom?.maxTokens && custom.maxTokens > 0) {
    return custom.maxTokens;
  }

  const limits = getModelLimits(modelId);
  return limits?.maxOutputTokens;
}
