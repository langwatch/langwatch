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
import { Settings } from "lucide-react";
import type { ReasoningConfig } from "../../server/modelProviders/llmModels.types";
import { parameterRegistry } from "./parameterRegistry";

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
  reasoning_effort: "reasoningEffort",
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
// Types
// ============================================================================

export type SliderParameterConfig = {
  type: "slider";
  min: number;
  max: number;
  step: number;
  default: number;
  label: string;
  helper: string;
  /** If true, max is determined by model's maxCompletionTokens */
  dynamicMax?: boolean;
};

export type SelectParameterConfig = {
  type: "select";
  options: readonly string[];
  default: string;
  label: string;
  helper: string;
  /** If true, options come from model's reasoningConfig */
  dynamicOptions?: boolean;
};

export type ParameterConfig = SliderParameterConfig | SelectParameterConfig;

// ============================================================================
// Parameter Definitions (derived from registry)
// ============================================================================

/**
 * Configuration for all known LLM parameters
 * The key matches the parameter name from supportedParameters
 *
 * @deprecated Use parameterRegistry.getConfig(name) instead
 */
export const PARAMETER_CONFIG: Record<string, ParameterConfig> =
  parameterRegistry.buildParameterConfig() as Record<string, ParameterConfig>;

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
  return (
    parameterRegistry.getIcon(paramName) ?? {
      icon: Settings,
      color: "gray.500",
    }
  );
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the config for a parameter, or undefined if not configured
 */
export function getParameterConfig(
  paramName: string,
): ParameterConfig | undefined {
  return PARAMETER_CONFIG[paramName];
}

/**
 * Get the effective config for a parameter, using model's reasoningConfig if applicable
 * This resolves dynamic options for reasoning parameters
 */
export function getEffectiveParameterConfig(
  paramName: string,
  reasoningConfig?: ReasoningConfig,
): ParameterConfig | undefined {
  const baseConfig = PARAMETER_CONFIG[paramName];
  if (!baseConfig) return undefined;

  // For reasoning parameters with dynamicOptions, use model's reasoningConfig
  if (
    baseConfig.type === "select" &&
    baseConfig.dynamicOptions &&
    reasoningConfig &&
    (paramName === "reasoning_effort" || paramName === "reasoning")
  ) {
    return {
      ...baseConfig,
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

  // Filter to only configured parameters that the model supports
  const configuredParams = supportedParameters.filter(
    (param) => PARAMETER_CONFIG[param] !== undefined,
  );

  // Sort by display order
  return configuredParams.sort((a, b) => {
    const aIndex = PARAMETER_DISPLAY_ORDER.indexOf(a);
    const bIndex = PARAMETER_DISPLAY_ORDER.indexOf(b);
    // If not in order list, put at end
    const aOrder = aIndex === -1 ? 999 : aIndex;
    const bOrder = bIndex === -1 ? 999 : bIndex;
    return aOrder - bOrder;
  });
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
  return ["reasoning_effort", "reasoning", "verbosity"].includes(paramName);
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
  return (
    supportedParameters.includes("reasoning") ||
    supportedParameters.includes("reasoning_effort")
  );
}
