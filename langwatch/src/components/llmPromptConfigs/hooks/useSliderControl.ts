/**
 * useSliderControl Hook
 *
 * Encapsulates the common slider control logic used by both ParameterField
 * and ParameterPopoverContent. Eliminates code duplication while allowing
 * each component to maintain its own styling.
 */

import { useEffect, useState } from "react";
import { DYNAMIC_MAX_DEFAULT_PROPORTION } from "../constants";
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
  /** Optional max override (e.g., model's maxCompletionTokens) */
  maxOverride?: number;
}

export interface UseSliderControlReturn {
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
// Hook Implementation
// ============================================================================

export function useSliderControl({
  config,
  value,
  onChange,
  maxOverride,
}: UseSliderControlParams): UseSliderControlReturn {
  // Calculate effective max - use model override for dynamic params
  const effectiveMax =
    config.dynamicMax && maxOverride ? maxOverride : config.max;

  // Smart default: for dynamic max params (like max_tokens), use ~25% of the model's max
  // This provides a sensible starting point while leaving room for adjustment
  const sensibleDefault =
    config.dynamicMax && maxOverride
      ? Math.min(
          config.default,
          Math.floor(maxOverride * DYNAMIC_MAX_DEFAULT_PROPORTION),
        )
      : config.default;

  const currentValue = value ?? sensibleDefault;

  // Ensure current value is within bounds
  const boundedValue = Math.min(
    Math.max(currentValue, config.min),
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
      // Clamp to bounds
      const clamped = Math.min(Math.max(parsed, config.min), effectiveMax);
      // Round to step precision
      const rounded = Math.round(clamped / config.step) * config.step;
      // Fix floating point precision
      const precision = String(config.step).split(".")[1]?.length ?? 0;
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
    effectiveMax,
    boundedValue,
    inputValue,
    handleInputChange,
    handleInputBlur,
    handleKeyDown,
    handleSliderChange,
  };
}
