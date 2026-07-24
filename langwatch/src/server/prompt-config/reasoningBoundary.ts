/**
 * Reasoning Boundary Layer
 *
 * This module handles the mapping between the unified 'reasoning' field
 * and provider-specific parameters at the boundary when calling LLM APIs.
 *
 * IMPORTANT: LiteLLM expects 'reasoning_effort' for ALL providers and transforms
 * it internally to provider-specific parameters:
 * - Anthropic: reasoning_effort -> output_config={"effort": ...} + beta header
 * - Gemini: reasoning_effort -> thinking_level or thinking with budget
 * - OpenAI: reasoning_effort -> passed as-is
 *
 * The model registry (llmModels.json) may still use provider-specific names like
 * 'effort' (Anthropic) and 'thinkingLevel' (Gemini) for UI clarity. This module
 * translates those to 'reasoning_effort' at the boundary before LiteLLM calls.
 *
 * This approach follows the Clean Architecture principle of isolating variability
 * at the boundaries, keeping the domain model stable and provider-agnostic.
 *
 * IMPORTANT: This logic is duplicated in Python (langwatch_nlp/studio/utils.py).
 * Changes here MUST be mirrored there.
 * @see langwatch_nlp/langwatch_nlp/studio/utils.py#map_reasoning_to_provider
 */

import { getModelById } from "../modelProviders/registry";

/**
 * Translation map from provider-specific parameter names to LiteLLM's expected parameter.
 *
 * LiteLLM expects 'reasoning_effort' for all providers - it handles the internal
 * transformation to provider-specific formats (e.g., Anthropic's output_config).
 *
 * The model registry may use provider-specific names for UI clarity:
 * - 'effort' (Anthropic) -> 'reasoning_effort'
 * - 'thinkingLevel' (Gemini) -> 'reasoning_effort'
 * - 'reasoning_effort' (OpenAI) -> 'reasoning_effort' (passthrough)
 */
export const LITELLM_PARAMETER_TRANSLATION: Record<string, string> = {
  effort: "reasoning_effort",
  thinkingLevel: "reasoning_effort",
  reasoning_effort: "reasoning_effort",
};


/**
 * Translates a parameter name to LiteLLM's expected format.
 *
 * @param parameterName - The parameter name from model registry (may be provider-specific)
 * @returns The translated parameter name for LiteLLM (always 'reasoning_effort' for known params)
 */
function translateToLiteLLMParam(parameterName: string): string {
  return LITELLM_PARAMETER_TRANSLATION[parameterName] ?? parameterName;
}

/**
 * Maps the unified 'reasoning' field to LiteLLM's expected parameter.
 *
 * IMPORTANT: LiteLLM expects 'reasoning_effort' for ALL providers. This function
 * translates provider-specific parameter names from the model registry to
 * 'reasoning_effort' at the boundary.
 *
 * @param model - The model identifier (e.g., "openai/gpt-5", "gemini/gemini-3-flash")
 * @param reasoning - The unified reasoning value
 * @returns Object with { reasoning_effort: value }, or undefined if reasoning is not set
 *
 * @example
 * mapReasoningToProvider("openai/gpt-5", "high")
 * // Returns: { reasoning_effort: "high" }
 *
 * @example
 * mapReasoningToProvider("gemini/gemini-3-flash", "low")
 * // Returns: { reasoning_effort: "low" }
 * // Note: Model registry may say 'thinkingLevel', but we translate to 'reasoning_effort'
 *
 * @example
 * mapReasoningToProvider("anthropic/claude-opus-4.5", "medium")
 * // Returns: { reasoning_effort: "medium" }
 * // Note: Model registry may say 'effort', but we translate to 'reasoning_effort'
 */
export function mapReasoningToProvider(
  model: string,
  reasoning: string | undefined,
): Record<string, string> | undefined {
  // Return undefined if reasoning is not set or empty
  if (!reasoning) {
    return undefined;
  }

  // Try to get the parameter name from model's reasoningConfig
  const modelData = getModelById(model);
  if (modelData?.reasoningConfig?.parameterName) {
    // Translate provider-specific param names to reasoning_effort for LiteLLM
    const translatedParam = translateToLiteLLMParam(
      modelData.reasoningConfig.parameterName,
    );
    return { [translatedParam]: reasoning };
  }

  // Default to reasoning_effort - LiteLLM expects this for ALL providers
  return { reasoning_effort: reasoning };
}

/**
 * Input type for normalizing provider-specific fields to unified reasoning.
 */
export interface ProviderReasoningFields {
  reasoning?: string;
  reasoning_effort?: string;
  thinkingLevel?: string;
  effort?: string;
}

/**
 * Normalizes provider-specific reasoning fields to the unified 'reasoning' field.
 *
 * This is used when reading data from the database that may contain
 * provider-specific fields from before the unification.
 *
 * Priority order: reasoning > reasoning_effort > thinkingLevel > effort
 *
 * @param data - Object containing any combination of reasoning fields
 * @returns The normalized reasoning value, or undefined if none are set
 *
 * @example
 * normalizeReasoningFromProviderFields({ reasoning_effort: "high" })
 * // Returns: "high"
 *
 * @example
 * normalizeReasoningFromProviderFields({ reasoning: "high", effort: "low" })
 * // Returns: "high" (reasoning takes precedence)
 */
export function normalizeReasoningFromProviderFields(
  data: ProviderReasoningFields,
): string | undefined {
  // Priority: reasoning > reasoning_effort > thinkingLevel > effort
  return (
    data.reasoning ?? data.reasoning_effort ?? data.thinkingLevel ?? data.effort
  );
}
