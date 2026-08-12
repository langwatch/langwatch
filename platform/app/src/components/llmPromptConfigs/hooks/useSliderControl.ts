/**
 * useSliderControl Hook
 *
 * Encapsulates the common slider control logic used by both ParameterField
 * and ParameterPopoverContent. Eliminates code duplication while allowing
 * each component to maintain its own styling.
 */

import { useEffect, useState } from "react";
import type { SliderParameterConfig } from "../parameterConfig";

// ============================================================================
// Types
// ============================================================================

export interface UseSliderControlParams {
  /** Slider parameter configuration */
  config: SliderParameterConfig;
  /** Current value (undefined means use default) */
  value: number | undefined;
  /** Callback when value changes */
  onChange: (value: number) => void;
  /** Optional max override (e.g., model's maxCompletionTokens or provider constraints) */
  maxOverride?: number;
  /** Optional min override (e.g., provider constraints) */
  minOverride?: number;
}

export interface UseSliderControlReturn {
  /** The effective min value (either from config or override) */
  effectiveMin: number;
  /** The effective max value (either from config or override) */
  effectiveMax: number;
  /** The bounded value clamped within min/max */
  boundedValue: number;
  /** Local input field value (string) while user is typing */
  inputValue: string;
  /** Handler for input value changes */
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Handler for input blur - validates and commits value */
  handleInputBlur: () => void;
  /** Handler for Enter key to commit value */
  handleKeyDown: (e: React.KeyboardEvent) => void;
  /** Handler for slider value changes */
  handleSliderChange: (values: number[]) => void;
}

// ============================================================================
// Utilities
// ============================================================================

/** Decimal places in a step value (e.g. 0.01 → 2, 256 → 0) */
export function stepPrecision(step: number): number {
  return String(step).split(".")[1]?.length ?? 0;
}

/**
 * Snap rawMax to the nearest step-aligned value above min.
 * zag-js requires max > min and (max - min) divisible by step.
 */
export function alignMaxToStep(
  rawMax: number,
  min: number,
  step: number,
): number {
  const range = rawMax - min;
  const stepsInRange = range > 0 ? Math.floor(range / step) : 0;
  const snappedMax = min + stepsInRange * step;
  const p = stepPrecision(step);
  return Math.max(
    Number(snappedMax.toFixed(p)),
    Number((min + step).toFixed(p)),
  );
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useSliderControl({
  config,
  value,
  onChange,
  maxOverride,
  minOverride,
}: UseSliderControlParams): UseSliderControlReturn {
  const precision = stepPrecision(config.step);

  // Calculate effective min - use override if provided (e.g., provider constraints)
  const effectiveMin = minOverride ?? config.min;

  // Calculate effective max - use model override for dynamic params or provider constraints
  // For dynamic max params (like max_tokens), always use the override
  // For other params, use override if it's more restrictive than config.max
  const rawMax =
    config.dynamicMax && maxOverride
      ? maxOverride
      : maxOverride !== undefined
        ? Math.min(maxOverride, config.max)
        : config.max;

  const effectiveMax = alignMaxToStep(rawMax, effectiveMin, config.step);

  // For dynamic max params (like max_tokens), default to the model's max
  // For other params, use the config default
  const sensibleDefault =
    config.dynamicMax && maxOverride ? maxOverride : config.default;

  const currentValue = value ?? sensibleDefault;

  // Ensure current value is within bounds
  const boundedValue = Math.min(
    Math.max(currentValue, effectiveMin),
    effectiveMax,
  );

  // Local state for input field while typing
  const [inputValue, setInputValue] = useState(String(boundedValue));

  // Sync input value when external value changes
  useEffect(() => {
    setInputValue(String(boundedValue));
  }, [boundedValue]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleInputBlur = () => {
    const parsed = parseFloat(inputValue);
    if (!isNaN(parsed)) {
      // Clamp to bounds (use effective min/max which include provider constraints)
      const clamped = Math.min(Math.max(parsed, effectiveMin), effectiveMax);
      // Round to step precision
      const rounded = Math.round(clamped / config.step) * config.step;
      const fixed = Number(rounded.toFixed(precision));
      onChange(fixed);
      setInputValue(String(fixed));
    } else {
      // Reset to current value if invalid
      setInputValue(String(boundedValue));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleInputBlur();
    }
  };

  const handleSliderChange = (values: number[]) => {
    onChange(values[0] ?? config.default);
  };

  return {
    effectiveMin,
    effectiveMax,
    boundedValue,
    inputValue,
    handleInputChange,
    handleInputBlur,
    handleKeyDown,
    handleSliderChange,
  };
}
