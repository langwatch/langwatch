/**
 * LLM Config Type Definitions
 *
 * Centralized type definitions for LLM configuration components.
 */

// ============================================================================
// External API Type (Backward Compatible)
// ============================================================================

/**
 * External LLM config values type - supports both naming conventions
 * for backward compatibility with existing form schemas.
 *
 * The max_tokens parameter uses a discriminated union to ensure only
 * one of max_tokens or maxTokens is set at a time.
 */
export type LLMConfigValues = {
  model: string;
  temperature?: number;
  // Traditional sampling parameters
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  // Other sampling parameters
  seed?: number;
  top_k?: number;
  min_p?: number;
  repetition_penalty?: number;
  // Reasoning model parameters
  reasoning_effort?: string;
  reasoning?: string;
  verbosity?: string;
} & (
  | { max_tokens?: number; maxTokens?: never }
  | { maxTokens?: number; max_tokens?: never }
);

// ============================================================================
// Internal Type (Clean snake_case)
// ============================================================================

/**
 * Internal LLM config values type used within components.
 * Uses consistent snake_case naming to match the canonical schema.
 *
 * Note: The external API (LLMConfigValues) still supports both naming
 * conventions for backward compatibility.
 */
export type InternalLLMConfig = {
  model: string;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  seed?: number;
  top_k?: number;
  min_p?: number;
  repetition_penalty?: number;
  reasoning_effort?: string;
  reasoning?: string;
  verbosity?: string;
};

// ============================================================================
// Adapter Functions
// ============================================================================

/**
 * Convert external config to internal format (normalize max_tokens).
 */
export function toInternalConfig(external: LLMConfigValues): InternalLLMConfig {
  const maxTokens = external.maxTokens ?? external.max_tokens;
  const { maxTokens: _, ...rest } = external as Record<string, unknown>;

  return {
    ...rest,
    max_tokens: maxTokens,
  } as InternalLLMConfig;
}

/**
 * Convert internal config back to external format, preserving original convention.
 */
export function toExternalConfig(
  internal: InternalLLMConfig,
  originalUsedCamelCase: boolean,
): LLMConfigValues {
  if (originalUsedCamelCase) {
    const { max_tokens, ...rest } = internal;
    return { ...rest, maxTokens: max_tokens } as LLMConfigValues;
  }
  return internal as LLMConfigValues;
}

/**
 * Check if the external config uses camelCase for maxTokens.
 */
export function usesCamelCaseMaxTokens(
  values: LLMConfigValues | Record<string, unknown>,
): boolean {
  return (values as Record<string, unknown>).maxTokens !== undefined;
}
