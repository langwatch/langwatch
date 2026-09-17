/** Reasoning boundary layer — maps unified reasoning field to provider-specific LiteLLM params. */

/** Translation map from provider-specific reasoning param names to LiteLLM's 'reasoning_effort'. */
export const LITELLM_PARAMETER_TRANSLATION: Record<string, string> = {
  effort: "reasoning_effort",
  thinkingLevel: "reasoning_effort",
  reasoning_effort: "reasoning_effort",
};

/** Maps unified reasoning field to LiteLLM's 'reasoning_effort' parameter. */
export function mapReasoningToProvider(
  _model: string,
  reasoning: string | undefined,
): Record<string, string> | undefined {
  // Return undefined if reasoning is not set or empty
  if (!reasoning) {
    return undefined;
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

/** Normalize provider-specific reasoning fields to unified field (reasoning has priority). */
export function normalizeReasoningFromProviderFields(
  data: ProviderReasoningFields,
): string | undefined {
  // Priority: reasoning > reasoning_effort > thinkingLevel > effort
  return data.reasoning ?? data.reasoning_effort ?? data.thinkingLevel ?? data.effort;
}
