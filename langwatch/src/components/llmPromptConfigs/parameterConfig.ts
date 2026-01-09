/**
 * LLM Parameter Configuration
 *
 * Defines the configuration for rendering LLM parameters dynamically based on
 * what each model supports. Parameters are rendered as sliders or selects
 * depending on their type.
 */

import type { ReasoningConfig } from "../../server/modelProviders/llmModels.types";

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
// Parameter Definitions
// ============================================================================

/**
 * Configuration for all known LLM parameters
 * The key matches the parameter name from supportedParameters
 */
export const PARAMETER_CONFIG: Record<string, ParameterConfig> = {
  // Traditional parameters
  temperature: {
    type: "slider",
    min: 0,
    max: 2,
    step: 0.1,
    default: 1,
    label: "Temperature",
    helper: "Controls randomness in the output",
  },
  top_p: {
    type: "slider",
    min: 0,
    max: 1,
    step: 0.01,
    default: 1,
    label: "Top P",
    helper: "Nucleus sampling probability mass",
  },
  max_tokens: {
    type: "slider",
    min: 256,
    max: 64000, // Will be overridden by model's maxCompletionTokens
    step: 256,
    default: 4096,
    label: "Max Tokens",
    helper: "Maximum output length",
    dynamicMax: true,
  },
  frequency_penalty: {
    type: "slider",
    min: 0,
    max: 2,
    step: 0.1,
    default: 0,
    label: "Frequency Penalty",
    helper: "Reduces repetition of frequent tokens",
  },
  presence_penalty: {
    type: "slider",
    min: 0,
    max: 2,
    step: 0.1,
    default: 0,
    label: "Presence Penalty",
    helper: "Encourages topic diversity",
  },

  // Reasoning model parameters
  // Note: These use dynamicOptions - actual options come from model's reasoningConfig
  reasoning_effort: {
    type: "select",
    options: ["none", "minimal", "low", "medium", "high", "xhigh"] as const, // Fallback options
    default: "medium",
    label: "Reasoning Effort",
    helper: "Computational effort for reasoning",
    dynamicOptions: true,
  },
  reasoning: {
    type: "select",
    options: ["none", "minimal", "low", "medium", "high", "xhigh"] as const, // Fallback options
    default: "medium",
    label: "Reasoning",
    helper: "Internal reasoning mode",
    dynamicOptions: true,
  },
  verbosity: {
    type: "select",
    options: ["low", "medium", "high"] as const,
    default: "medium",
    label: "Verbosity",
    helper: "Response detail level",
  },

  // Other parameters
  seed: {
    type: "slider",
    min: 0,
    max: 999999999,
    step: 1,
    default: 0,
    label: "Seed",
    helper: "For deterministic outputs (0 = random)",
  },
  top_k: {
    type: "slider",
    min: 1,
    max: 100,
    step: 1,
    default: 40,
    label: "Top K",
    helper: "Limits token selection to top K",
  },
  min_p: {
    type: "slider",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0,
    label: "Min P",
    helper: "Minimum probability threshold",
  },
  repetition_penalty: {
    type: "slider",
    min: 1,
    max: 2,
    step: 0.1,
    default: 1,
    label: "Repetition Penalty",
    helper: "Penalizes repeated tokens",
  },
};

// ============================================================================
// Default Parameters
// ============================================================================

/**
 * Default parameters shown when a model has no supportedParameters
 */
export const DEFAULT_SUPPORTED_PARAMETERS = ["temperature", "max_tokens"];

/**
 * Parameters that should always be available (user-facing core params)
 */
export const CORE_PARAMETERS = [
  "temperature",
  "max_tokens",
  "top_p",
  "frequency_penalty",
  "presence_penalty",
  "reasoning_effort",
  "reasoning",
  "verbosity",
];

/**
 * Order in which parameters should be displayed
 */
export const PARAMETER_DISPLAY_ORDER = [
  // Reasoning params first (for newer models)
  "reasoning_effort",
  "reasoning",
  "verbosity",
  // Traditional params
  "temperature",
  "max_tokens",
  "top_p",
  "frequency_penalty",
  "presence_penalty",
  // Less common
  "top_k",
  "min_p",
  "repetition_penalty",
  "seed",
];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the config for a parameter, or undefined if not configured
 */
export function getParameterConfig(
  paramName: string
): ParameterConfig | undefined {
  return PARAMETER_CONFIG[paramName];
}

/**
 * Get the effective config for a parameter, using model's reasoningConfig if applicable
 * This resolves dynamic options for reasoning parameters
 */
export function getEffectiveParameterConfig(
  paramName: string,
  reasoningConfig?: ReasoningConfig
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
    (param) => PARAMETER_CONFIG[param] !== undefined
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
