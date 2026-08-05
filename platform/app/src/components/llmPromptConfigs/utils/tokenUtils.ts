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
 * Calculate sensible default values for all parameters.
 * Uses registry defaults, with special handling for dynamic parameters like max_tokens.
 *
 * @param modelMetadata - Optional model metadata for dynamic calculations
 * @param registry - Parameter registry (defaults to singleton)
 * @returns Record of parameter formKeys to their default values
 */
export function calculateSensibleDefaults(
  modelMetadata?: ModelMetadataForFrontend,
  registry: typeof defaultRegistry = defaultRegistry,
): Record<string, number | string | undefined> {
  const defaults: Record<string, number | string | undefined> = {};

  for (const paramName of registry.getAllNames()) {
    const config = registry.getConfig(paramName);
    if (!config) continue;

    const formKey = registry.getFormKey(paramName);

    if (paramName === "max_tokens" && config.type === "slider") {
      // Default to model's absolute maximum
      if (modelMetadata) {
        const maxLimit = getMaxTokenLimit(modelMetadata);
        // Set both camelCase and snake_case for compatibility with different consumers
        defaults[formKey] = maxLimit;
        defaults[paramName] = maxLimit;
      }
      // If no metadata, leave undefined (backward compat - Python will use its fallback)
    } else if (config.type === "slider") {
      // Use registry default for other sliders
      defaults[formKey] = config.default;
    } else if (config.type === "select" && config.default) {
      // Use registry default for selects (reasoning, verbosity)
      defaults[formKey] = config.default;
    }
    // Leave undefined for params without defaults
  }

  return defaults;
}

/**
 * Returns a clean LLMConfig for a new model.
 * Clears all registered parameters and applies sensible defaults.
 *
 * For max_tokens specifically:
 * - If previous value was at the previous model's max → set to new model's max (keep maxed)
 * - If previous value was below max (user customized) → min(previous, new max)
 *
 * @param newModel - The new model identifier
 * @param registry - Parameter registry (defaults to singleton)
 * @param newModelMetadata - Optional model metadata for the new model
 * @param previousValues - Optional previous config values (for smart max_tokens handling)
 * @param previousModelMetadata - Optional metadata for the previous model
 */
export function buildModelChangeValues(
  newModel: string,
  registry: typeof defaultRegistry = defaultRegistry,
  newModelMetadata?: ModelMetadataForFrontend,
  previousValues?: LLMConfigValues,
  previousModelMetadata?: ModelMetadataForFrontend,
): LLMConfigValues {
  const result: LLMConfigValues = { model: newModel };
  const resultRecord = result as Record<string, unknown>;

  // First clear all parameters (to remove stale values from previous model)
  for (const paramName of registry.getAllNames()) {
    resultRecord[paramName] = undefined;
    const formKey = registry.getFormKey(paramName);
    if (formKey !== paramName) {
      resultRecord[formKey] = undefined;
    }
  }

  // Then apply sensible defaults so form state matches what UI displays
  const defaults = calculateSensibleDefaults(newModelMetadata, registry);
  for (const [key, value] of Object.entries(defaults)) {
    if (value !== undefined) {
      resultRecord[key] = value;
    }
  }

  // Smart max_tokens handling when switching models
  if (previousValues && newModelMetadata) {
    const previousMaxTokens =
      (previousValues.maxTokens as number | undefined) ??
      (previousValues.max_tokens as number | undefined);

    if (previousMaxTokens !== undefined) {
      const previousMax = previousModelMetadata
        ? getMaxTokenLimit(previousModelMetadata)
        : previousMaxTokens; // If no previous metadata, assume it was at max
      const newMax = getMaxTokenLimit(newModelMetadata);

      // Check if previous value was at the max (user hadn't customized it)
      const wasAtMax = previousMaxTokens >= previousMax;

      const newMaxTokens = wasAtMax
        ? newMax // Keep it maxed out for the new model
        : Math.min(previousMaxTokens, newMax); // User had a custom value - cap it at new model's max

      // Set both camelCase and snake_case for compatibility with different consumers
      resultRecord.maxTokens = newMaxTokens;
      resultRecord.max_tokens = newMaxTokens;
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
