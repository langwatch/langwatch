/**
 * Token Utilities
 *
 * Helper functions for managing max_tokens normalization and model change handling.
 */

import type { ModelMetadataForFrontend } from "../../../hooks/useModelProvidersSettings";
import { FALLBACK_MAX_TOKENS } from "../../../utils/constants";
import { parameterRegistry as defaultRegistry } from "../parameterRegistry";
import type { LLMConfigValues } from "../types";

/**
 * Returns a clean LLMConfig for a new model.
 * Clears all registered parameters using the registry as source of truth.
 */
export function buildModelChangeValues(
  newModel: string,
  registry: typeof defaultRegistry = defaultRegistry,
): LLMConfigValues {
  const result: LLMConfigValues = { model: newModel };
  const resultRecord = result as Record<string, unknown>;

  for (const paramName of registry.getAllNames()) {
    resultRecord[paramName] = undefined;
    const formKey = registry.getFormKey(paramName);
    if (formKey !== paramName) {
      resultRecord[formKey] = undefined;
    }
  }

  return result;
}

/**
 * Ensures only one of maxTokens or max_tokens is set in the config.
 * Preserves the naming convention the caller was using.
 */
export function normalizeMaxTokens(
  values: Record<string, unknown>,
  tokenValue: number,
): LLMConfigValues {
  const usesCamelCase = Object.hasOwn(values, "maxTokens");
  const model = (values.model ?? "") as string;

  const {
    maxTokens: _sunkMaxTokens,
    max_tokens: _sunkMaxTokens2,
    model: _sunkModel,
    ...rest
  } = values;

  const result: LLMConfigValues = usesCamelCase
    ? { model, ...rest, maxTokens: tokenValue }
    : { model, ...rest, max_tokens: tokenValue };

  return result;
}

/**
 * Calculate the max token limit for a model.
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
