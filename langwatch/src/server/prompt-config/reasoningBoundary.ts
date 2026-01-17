/**
 * Reasoning Boundary Layer
 *
 * This module handles the mapping between the unified 'reasoning' field
 * and provider-specific parameters at the boundary when calling LLM APIs.
 *
 * The 'reasoning' field is the canonical/unified field used throughout the system.
 * Provider-specific parameters (reasoning_effort, thinkingLevel, effort) are only
 * used when making actual API calls to the respective providers.
 *
 * This approach follows the Clean Architecture principle of isolating variability
 * at the boundaries, keeping the domain model stable and provider-agnostic.
 */

import { getModelById } from "../modelProviders/registry";
import { getProviderFromModel } from "../../utils/modelProviderHelpers";

/**
 * Provider-specific reasoning parameter names.
 * Used as fallback when model registry doesn't have reasoningConfig.
 */
const PROVIDER_REASONING_FALLBACKS: Record<string, string> = {
  openai: "reasoning_effort",
  google: "thinkingLevel",
  gemini: "thinkingLevel", // Alias - registry models use provider "gemini"
  anthropic: "effort",
};

/**
 * Maps the unified 'reasoning' field to the provider-specific parameter.
 *
 * Uses the model's reasoningConfig.parameterName if available,
 * otherwise falls back to provider-based mapping.
 *
 * @param model - The model identifier (e.g., "openai/gpt-5", "gemini/gemini-3-flash")
 * @param reasoning - The unified reasoning value
 * @returns Object with provider-specific key and value, or undefined if reasoning is not set
 *
 * @example
 * mapReasoningToProvider("openai/gpt-5", "high")
 * // Returns: { reasoning_effort: "high" }
 *
 * @example
 * mapReasoningToProvider("gemini/gemini-3-flash", "low")
 * // Returns: { thinkingLevel: "low" }
 */
export function mapReasoningToProvider(
  model: string,
  reasoning: string | undefined
): Record<string, string> | undefined {
  // Return undefined if reasoning is not set or empty
  if (!reasoning) {
    return undefined;
  }

  // Try to get the parameter name from model's reasoningConfig
  const modelData = getModelById(model);
  if (modelData?.reasoningConfig?.parameterName) {
    return { [modelData.reasoningConfig.parameterName]: reasoning };
  }

  // Fall back to provider-based mapping
  const provider = getProviderFromModel(model);
  const paramKey = PROVIDER_REASONING_FALLBACKS[provider];
  if (paramKey) {
    return { [paramKey]: reasoning };
  }

  // Default to reasoning_effort for unknown providers
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
  data: ProviderReasoningFields
): string | undefined {
  // Priority: reasoning > reasoning_effort > thinkingLevel > effort
  return (
    data.reasoning ?? data.reasoning_effort ?? data.thinkingLevel ?? data.effort
  );
}
