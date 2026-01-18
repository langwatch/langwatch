/**
 * Token Utilities
 *
 * Helper functions for managing max_tokens normalization and model change handling.
 */

import type { ModelMetadataForFrontend } from "../../../hooks/useModelProvidersSettings";
import { FALLBACK_MAX_TOKENS } from "../../../utils/constants";
import { DYNAMIC_MAX_DEFAULT_PROPORTION } from "../constants";
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
      // Dynamic default based on model's maxCompletionTokens
      if (modelMetadata) {
        const maxLimit = getMaxTokenLimit(modelMetadata);
        defaults[formKey] = Math.min(
          config.default,
          Math.floor(maxLimit * DYNAMIC_MAX_DEFAULT_PROPORTION),
        );
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
 * @param newModel - The new model identifier
 * @param registry - Parameter registry (defaults to singleton)
 * @param modelMetadata - Optional model metadata for dynamic defaults (e.g., max_tokens)
 */
export function buildModelChangeValues(
  newModel: string,
  registry: typeof defaultRegistry = defaultRegistry,
  modelMetadata?: ModelMetadataForFrontend,
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
  const defaults = calculateSensibleDefaults(modelMetadata, registry);
  for (const [key, value] of Object.entries(defaults)) {
    if (value !== undefined) {
      resultRecord[key] = value;
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
