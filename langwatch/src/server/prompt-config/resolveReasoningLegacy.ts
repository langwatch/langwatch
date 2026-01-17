/**
 * Utility for mapping legacy 'reasoning' field to provider-specific parameters.
 *
 * Background: The 'reasoning' field was the original generic parameter for reasoning
 * model configuration. It has been replaced by provider-specific parameters:
 * - OpenAI: reasoning_effort
 * - Gemini: thinkingLevel
 * - Anthropic: effort
 *
 * This utility provides backward compatibility by mapping legacy 'reasoning' values
 * to the appropriate provider-specific parameter based on the model.
 */

import { getProviderFromModel } from "../../utils/modelProviderHelpers";
import { getModelById } from "../modelProviders/registry";

/**
 * Provider-specific reasoning parameter names.
 * Used as fallback when model registry doesn't have reasoningConfig.
 */
const PROVIDER_REASONING_PARAMS: Record<string, string> = {
  openai: "reasoning_effort",
  google: "thinkingLevel",
  anthropic: "effort",
};

/**
 * Maps legacy 'reasoning' field to the provider-specific parameter.
 *
 * Resolution order:
 * 1. Use model's reasoningConfig.parameterName if available
 * 2. Fall back to provider-based mapping
 * 3. Default to 'reasoning_effort' for unknown providers
 *
 * @param model - The model identifier (e.g., "openai/gpt-4", "google/gemini-2.0-flash")
 * @param reasoningValue - The value of the legacy reasoning field
 * @returns Object with the resolved parameter key and value
 */
export function resolveReasoningToProviderParam(
  model: string,
  reasoningValue: string,
): { key: string; value: string } {
  // Try to get the parameter name from model's reasoningConfig
  const modelData = getModelById(model);
  if (modelData?.reasoningConfig?.parameterName) {
    return { key: modelData.reasoningConfig.parameterName, value: reasoningValue };
  }

  // Fall back to provider-based mapping
  const provider = getProviderFromModel(model);
  const paramKey = PROVIDER_REASONING_PARAMS[provider];
  if (paramKey) {
    return { key: paramKey, value: reasoningValue };
  }

  // Default to reasoning_effort for unknown providers
  return { key: "reasoning_effort", value: reasoningValue };
}
