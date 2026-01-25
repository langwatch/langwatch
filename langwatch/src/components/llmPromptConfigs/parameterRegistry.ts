/**
 * Parameter Registry
 *
 * Single source of truth for LLM parameter configuration.
 * Consolidates parameter config, icons, display order, and naming conventions
 * into a single registration per parameter.
 *
 * This addresses the OCP violation where adding a new parameter required
 * modifying 4+ different constants.
 */

import type { LucideIcon } from "lucide-react";
import {
  ArrowUpDown,
  Brain,
  Dices,
  Gauge,
  Hash,
  Layers,
  MessageSquare,
  Repeat,
  Settings,
  Target,
  Thermometer,
} from "lucide-react";
import type { ReasoningConfig } from "../../server/modelProviders/llmModels.types";

// ============================================================================
// Types
// ============================================================================

export type SliderParameterDefinition = {
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

export type SelectParameterDefinition = {
  type: "select";
  options: readonly string[];
  default: string;
  label: string;
  helper: string;
  /** If true, options come from model's reasoningConfig */
  dynamicOptions?: boolean;
};

export type ParameterDefinition =
  | SliderParameterDefinition
  | SelectParameterDefinition;

export interface ParameterRegistration {
  /** Snake_case parameter name (canonical) */
  name: string;
  /** CamelCase form key (if different from name) */
  formKey?: string;
  /** Configuration for the parameter UI */
  config: ParameterDefinition;
  /** Icon for compact mode display */
  icon: LucideIcon;
  /** Icon color (Chakra color token) */
  iconColor: string;
  /** Display order (lower = earlier, 0-based) */
  displayOrder: number;
  /** Whether this is a core/common parameter */
  isCore?: boolean;
  /** Whether this is a reasoning-specific parameter */
  isReasoning?: boolean;
}

// ============================================================================
// Registry Class
// ============================================================================

export class ParameterRegistry {
  private parameters: Map<string, ParameterRegistration> = new Map();

  /**
   * Register a parameter configuration.
   * All parameter data is defined in a single place.
   */
  register(registration: ParameterRegistration): void {
    this.parameters.set(registration.name, registration);
  }

  /**
   * Get a parameter registration by name.
   */
  get(name: string): ParameterRegistration | undefined {
    return this.parameters.get(name);
  }

  /**
   * Get the parameter config (without icon/order metadata).
   */
  getConfig(name: string): ParameterDefinition | undefined {
    return this.parameters.get(name)?.config;
  }

  /**
   * Get all registered parameter names.
   */
  getAllNames(): string[] {
    return Array.from(this.parameters.keys());
  }

  /**
   * Get parameters sorted by display order.
   */
  getDisplayOrder(): string[] {
    return Array.from(this.parameters.values())
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((p) => p.name);
  }

  /**
   * Get core parameters.
   */
  getCoreParameters(): string[] {
    return Array.from(this.parameters.values())
      .filter((p) => p.isCore)
      .map((p) => p.name);
  }

  /**
   * Get reasoning parameters.
   */
  getReasoningParameters(): string[] {
    return Array.from(this.parameters.values())
      .filter((p) => p.isReasoning)
      .map((p) => p.name);
  }

  /**
   * Get the form key for a parameter (camelCase).
   */
  getFormKey(name: string): string {
    const reg = this.parameters.get(name);
    return reg?.formKey ?? name;
  }

  /**
   * Get the effective config, applying dynamic options from reasoningConfig.
   */
  getEffectiveConfig(
    name: string,
    reasoningConfig?: ReasoningConfig,
  ): ParameterDefinition | undefined {
    const reg = this.parameters.get(name);
    if (!reg) return undefined;

    const baseConfig = reg.config;

    // Apply dynamic options for the unified reasoning parameter
    // Options come from model's reasoningConfig.allowedValues
    if (
      baseConfig.type === "select" &&
      baseConfig.dynamicOptions &&
      reasoningConfig &&
      name === "reasoning"
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
   * Get icon configuration for a parameter.
   */
  getIcon(name: string): { icon: LucideIcon; color: string } {
    const reg = this.parameters.get(name);
    if (!reg) {
      return { icon: Settings, color: "gray.500" };
    }
    return { icon: reg.icon, color: reg.iconColor };
  }

  /**
   * Filter and sort parameters for display.
   */
  getDisplayParameters(supportedParameters: string[]): string[] {
    if (!supportedParameters || supportedParameters.length === 0) {
      return ["temperature", "max_tokens"]; // Default
    }

    const displayOrder = this.getDisplayOrder();

    return supportedParameters
      .filter((param) => this.parameters.has(param))
      .sort((a, b) => {
        const aIndex = displayOrder.indexOf(a);
        const bIndex = displayOrder.indexOf(b);
        const aOrder = aIndex === -1 ? 999 : aIndex;
        const bOrder = bIndex === -1 ? 999 : bIndex;
        return aOrder - bOrder;
      });
  }

  /**
   * Build the name mapping (snake_case -> camelCase).
   */
  buildNameMapping(): Record<string, string> {
    const mapping: Record<string, string> = {};
    for (const [name, reg] of this.parameters) {
      if (reg.formKey && reg.formKey !== name) {
        mapping[name] = reg.formKey;
      }
    }
    return mapping;
  }

  /**
   * Build the parameter config record (for backward compatibility).
   */
  buildParameterConfig(): Record<string, ParameterDefinition> {
    const config: Record<string, ParameterDefinition> = {};
    for (const [name, reg] of this.parameters) {
      config[name] = reg.config;
    }
    return config;
  }

  /**
   * Build the parameter icons record (for backward compatibility).
   */
  buildParameterIcons(): Record<string, { icon: LucideIcon; color: string }> {
    const icons: Record<string, { icon: LucideIcon; color: string }> = {};
    for (const [name, reg] of this.parameters) {
      icons[name] = { icon: reg.icon, color: reg.iconColor };
    }
    return icons;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const parameterRegistry = new ParameterRegistry();

// ============================================================================
// Parameter Registrations (Single Source of Truth)
// ============================================================================

// Unified reasoning parameter (display order 0)
// Provider-specific mapping happens at runtime boundary (reasoningBoundary.ts)
parameterRegistry.register({
  name: "reasoning",
  config: {
    type: "select",
    options: ["low", "medium", "high"] as const,
    default: "medium",
    label: "Reasoning",
    helper:
      "How much the model thinks. Higher = more thorough but slower.",
    dynamicOptions: true,
  },
  icon: Brain,
  iconColor: "cyan.500",
  displayOrder: 0,
  isCore: true,
  isReasoning: true,
});

parameterRegistry.register({
  name: "verbosity",
  config: {
    type: "select",
    options: ["low", "medium", "high"] as const,
    default: "medium",
    label: "Verbosity",
    helper: "Low = brief responses. High = detailed explanations.",
  },
  icon: MessageSquare,
  iconColor: "teal.500",
  displayOrder: 4,
  isCore: true,
  isReasoning: true,
});

// Traditional parameters (display order 5-9)
parameterRegistry.register({
  name: "temperature",
  config: {
    type: "slider",
    min: 0,
    max: 2,
    step: 0.1,
    default: 1,
    label: "Temperature",
    helper:
      "Lower = more focused and consistent. Higher = more creative and varied.",
  },
  icon: Thermometer,
  iconColor: "orange.500",
  displayOrder: 5,
  isCore: true,
});

parameterRegistry.register({
  name: "max_tokens",
  formKey: "maxTokens",
  config: {
    type: "slider",
    min: 256,
    max: 64000,
    step: 256,
    default: 4096,
    label: "Max Tokens",
    helper: "Maximum response length (roughly 4 characters per token).",
    dynamicMax: true,
  },
  icon: Hash,
  iconColor: "green.500",
  displayOrder: 6,
  isCore: true,
});

parameterRegistry.register({
  name: "top_p",
  formKey: "topP",
  config: {
    type: "slider",
    min: 0,
    max: 1,
    step: 0.01,
    default: 1,
    label: "Top P",
    helper: "Limits word choices. Lower = more focused responses.",
  },
  icon: Gauge,
  iconColor: "blue.500",
  displayOrder: 7,
  isCore: true,
});

parameterRegistry.register({
  name: "frequency_penalty",
  formKey: "frequencyPenalty",
  config: {
    type: "slider",
    min: 0,
    max: 2,
    step: 0.1,
    default: 0,
    label: "Frequency Penalty",
    helper: "Higher = less likely to repeat the same words.",
  },
  icon: Repeat,
  iconColor: "purple.500",
  displayOrder: 8,
  isCore: true,
});

parameterRegistry.register({
  name: "presence_penalty",
  formKey: "presencePenalty",
  config: {
    type: "slider",
    min: 0,
    max: 2,
    step: 0.1,
    default: 0,
    label: "Presence Penalty",
    helper: "Higher = more likely to talk about new topics.",
  },
  icon: Target,
  iconColor: "pink.500",
  displayOrder: 9,
  isCore: true,
});

// Less common parameters (display order 10-13)
parameterRegistry.register({
  name: "top_k",
  formKey: "topK",
  config: {
    type: "slider",
    min: 1,
    max: 100,
    step: 1,
    default: 40,
    label: "Top K",
    helper: "Limits how many word options the model considers at each step.",
  },
  icon: Layers,
  iconColor: "indigo.500",
  displayOrder: 10,
});

parameterRegistry.register({
  name: "min_p",
  formKey: "minP",
  config: {
    type: "slider",
    min: 0,
    max: 1,
    step: 0.01,
    default: 0,
    label: "Min P",
    helper: "Filters out unlikely words. Higher = only likely choices.",
  },
  icon: ArrowUpDown,
  iconColor: "red.500",
  displayOrder: 11,
});

parameterRegistry.register({
  name: "repetition_penalty",
  formKey: "repetitionPenalty",
  config: {
    type: "slider",
    min: 1,
    max: 2,
    step: 0.1,
    default: 1,
    label: "Repetition Penalty",
    helper: "Higher = less repetition of phrases.",
  },
  icon: Repeat,
  iconColor: "yellow.600",
  displayOrder: 12,
});

parameterRegistry.register({
  name: "seed",
  config: {
    type: "slider",
    min: 0,
    max: 999999999,
    step: 1,
    default: 0,
    label: "Seed",
    helper: "Set a number for reproducible results. Same seed = same output.",
  },
  icon: Dices,
  iconColor: "gray.500",
  displayOrder: 13,
});
