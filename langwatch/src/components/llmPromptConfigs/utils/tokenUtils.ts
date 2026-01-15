/**
 * Token Utilities
 *
 * Helper functions for managing max_tokens normalization and model change handling.
 * Extracted from LLMConfigPopover to improve Single Responsibility.
 */

import type { ModelMetadataForFrontend } from "../../../hooks/useModelProvidersSettings";
import { FALLBACK_MAX_TOKENS } from "../../../utils/constants";
import { parameterRegistry } from "../parameterRegistry";
import type { LLMConfigValues } from "../types";

// ============================================================================
// Model Change Handling
// ============================================================================

/**
 * Returns a clean LLMConfig for a new model.
 * Explicitly clears all registered parameters using the registry as source of truth.
 * This ensures new parameters added to the registry are automatically included.
 *
 * @param newModel - New model identifier
 * @returns Config with model and all parameters explicitly set to undefined
 */
export function buildModelChangeValues(newModel: string): LLMConfigValues {
  const clearedParams: Record<string, undefined> = {};

  // Use registry as single source of truth (OCP compliant)
  for (const paramName of parameterRegistry.getAllNames()) {
    // Clear snake_case name
    clearedParams[paramName] = undefined;
    // Clear camelCase variant if different
    const formKey = parameterRegistry.getFormKey(paramName);
    if (formKey !== paramName) {
      clearedParams[formKey] = undefined;
    }
  }

  return {
    ...clearedParams,
    model: newModel,
  } as LLMConfigValues;
}

// ============================================================================
// Token Normalization
// ============================================================================

/**
 * Ensures only one of maxTokens or max_tokens is set in the config.
 * Preserves the naming convention the caller was using.
 *
 * @param values - Current config values (may have maxTokens or max_tokens)
 * @param tokenValue - New token value to set
 * @returns Updated config with only one token key
 */
export function normalizeMaxTokens(
  values: Record<string, unknown>,
  tokenValue: number,
): LLMConfigValues {
  // Check key existence, not value - handles explicit undefined from buildModelChangeValues
  const usesCamelCase = Object.hasOwn(values, "maxTokens");

  const {
    maxTokens: _sunkMaxTokens,
    max_tokens: _sunkMaxTokens2,
    ...rest
  } = values;

  if (usesCamelCase) {
    return { ...rest, maxTokens: tokenValue } as LLMConfigValues;
  } else {
    return { ...rest, max_tokens: tokenValue } as LLMConfigValues;
  }
}

// ============================================================================
// Token Limit Calculation
// ============================================================================

/**
 * Calculate the max token limit for a model.
 *
 * @param modelMetadata - Metadata for the model
 * @returns Max token limit (falls back to FALLBACK_MAX_TOKENS)
 */
export function getMaxTokenLimit(
  modelMetadata: ModelMetadataForFrontend | undefined,
): number {
  return (
    modelMetadata?.maxCompletionTokens ??
    modelMetadata?.contextLength ??
    FALLBACK_MAX_TOKENS
  );
}
