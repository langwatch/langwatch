/**
 * LLM Parameter Configuration
 *
 * Defines the configuration for rendering LLM parameters dynamically based on
 * what each model supports. Parameters are rendered as sliders or selects
 * depending on their type.
 *
 * NOTE: This file re-exports from parameterRegistry for backward compatibility.
 * New code should use parameterRegistry directly for better type safety and
 * to benefit from the single-source-of-truth pattern.
 *
 * @see parameterRegistry.ts for the canonical parameter definitions
 */

import type { LucideIcon } from "lucide-react";
import type { ReasoningConfig } from "../../server/modelProviders/llmModels.types";
import {
  parameterRegistry,
  type ParameterDefinition,
} from "./parameterRegistry";

// ============================================================================
// Parameter Name Mapping (snake_case ↔ camelCase)
// ============================================================================

/**
 * Maps internal snake_case parameter names to form camelCase names.
 * This is needed because the form schema uses camelCase while the
 * parameter display uses snake_case internally.
 */
export const PARAM_NAME_MAPPING: Record<string, string> = {
  top_p: "topP",
  frequency_penalty: "frequencyPenalty",
  presence_penalty: "presencePenalty",
  max_tokens: "maxTokens",
  top_k: "topK",
  min_p: "minP",
  repetition_penalty: "repetitionPenalty",
  // These are the same in both: temperature, reasoning, verbosity, seed, model
};

/**
 * Converts a snake_case parameter name to its camelCase form key.
 * Returns the original key if no mapping exists (e.g., temperature, seed).
 */
export function toFormKey(snakeCaseKey: string): string {
  return PARAM_NAME_MAPPING[snakeCaseKey] ?? snakeCaseKey;
}

/**
 * Reverse mapping from camelCase to snake_case
 */
const REVERSE_PARAM_MAPPING: Record<string, string> = Object.fromEntries(
  Object.entries(PARAM_NAME_MAPPING).map(([snake, camel]) => [camel, snake]),
);

/**
 * Converts a camelCase form key to its snake_case internal key.
 * Returns the original key if no mapping exists.
 */
export function toInternalKey(camelCaseKey: string): string {
  return REVERSE_PARAM_MAPPING[camelCaseKey] ?? camelCaseKey;
}

// ============================================================================
// Types (re-exported from parameterRegistry for backward compatibility)
// ============================================================================

/**
 * @deprecated Use SliderParameterDefinition from parameterRegistry.ts
 */
export type {
  SliderParameterDefinition as SliderParameterConfig,
  SelectParameterDefinition as SelectParameterConfig,
  ParameterDefinition as ParameterConfig,
} from "./parameterRegistry";

// ============================================================================
// Parameter Definitions (derived from registry)
// ============================================================================

/**
 * Configuration for all known LLM parameters
 * The key matches the parameter name from supportedParameters
 *
 * @deprecated Use parameterRegistry.getConfig(name) instead
 */
export const PARAMETER_CONFIG: Record<string, ParameterDefinition> =
  parameterRegistry.buildParameterConfig() as Record<string, ParameterDefinition>;

// ============================================================================
// Default Parameters (derived from registry)
// ============================================================================

/**
 * Default parameters shown when a model has no supportedParameters
 */
export const DEFAULT_SUPPORTED_PARAMETERS = ["temperature", "max_tokens"];

/**
 * Parameters that should always be available (user-facing core params)
 *
 * @deprecated Use parameterRegistry.getCoreParameters() instead
 */
export const CORE_PARAMETERS = parameterRegistry.getCoreParameters();

/**
 * Order in which parameters should be displayed
 *
 * @deprecated Use parameterRegistry.getDisplayOrder() instead
 */
export const PARAMETER_DISPLAY_ORDER = parameterRegistry.getDisplayOrder();

// ============================================================================
// Parameter Icons (for compact mode, derived from registry)
// ============================================================================

export type ParameterIcon = {
  icon: LucideIcon;
  color: string;
};

/**
 * Icon mapping for parameters in compact display mode
 *
 * @deprecated Use parameterRegistry.getIcon(name) instead
 */
export const PARAMETER_ICONS: Record<string, ParameterIcon> =
  parameterRegistry.buildParameterIcons();

/**
 * Get the icon config for a parameter
 */
export function getParameterIcon(paramName: string): ParameterIcon {
  return parameterRegistry.getIcon(paramName);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the config for a parameter, or undefined if not configured
 */
export function getParameterConfig(
  paramName: string,
): ParameterDefinition | undefined {
  return PARAMETER_CONFIG[paramName];
}

/**
 * Maps provider-specific parameter names to display labels.
 * Used for showing provider-appropriate labels in the UI.
 *
 * Note: Keys match the exact parameter names from each provider's API:
 * - reasoning_effort: OpenAI
 * - thinkingLevel: Gemini (camelCase is the actual Gemini API format)
 * - effort: Anthropic
 */
const REASONING_PARAMETER_LABELS: Record<string, string> = {
  reasoning_effort: "Reasoning Effort",
  thinkingLevel: "Thinking Level",
  effort: "Effort",
};

/**
 * Get the effective config for a parameter, using model's reasoningConfig if applicable.
 * This resolves dynamic options AND dynamic labels for the unified reasoning parameter.
 *
 * @param paramName - The parameter name (e.g., "reasoning", "temperature")
 * @param reasoningConfig - Model's reasoning configuration (optional)
 * @returns ParameterConfig with resolved options and label, or undefined if not configured
 */
export function getParameterConfigWithModelOverrides(
  paramName: string,
  reasoningConfig?: ReasoningConfig,
): ParameterDefinition | undefined {
  const baseConfig = PARAMETER_CONFIG[paramName];
  if (!baseConfig) return undefined;

  // For the unified reasoning parameter with dynamicOptions, use model's reasoningConfig
  if (
    baseConfig.type === "select" &&
    baseConfig.dynamicOptions &&
    reasoningConfig &&
    paramName === "reasoning"
  ) {
    // Determine the display label based on provider's parameter name
    const dynamicLabel =
      REASONING_PARAMETER_LABELS[reasoningConfig.parameterName] ?? "Reasoning";

    return {
      ...baseConfig,
      label: dynamicLabel,
      options: reasoningConfig.allowedValues,
      default: reasoningConfig.defaultValue,
    };
  }

  return baseConfig;
}

/**
 * Filter and sort parameters for display
 * Only returns parameters that have a config and are in the display order
 */
export function getDisplayParameters(supportedParameters: string[]): string[] {
  if (!supportedParameters || supportedParameters.length === 0) {
    return DEFAULT_SUPPORTED_PARAMETERS;
  }
  return parameterRegistry.getDisplayParameters(supportedParameters);
}

/**
 * Get the default value for a parameter
 */
export function getParameterDefault(paramName: string): unknown {
  const config = PARAMETER_CONFIG[paramName];
  return config?.default;
}

/**
 * Check if a parameter is a reasoning-type parameter
 */
export function isReasoningParameter(paramName: string): boolean {
  return ["reasoning", "verbosity"].includes(paramName);
}

/**
 * Check if a model supports traditional temperature
 */
export function supportsTemperature(supportedParameters: string[]): boolean {
  return supportedParameters.includes("temperature");
}

/**
 * Check if a model supports reasoning parameters
 */
export function supportsReasoning(supportedParameters: string[]): boolean {
  return supportedParameters.includes("reasoning");
}
