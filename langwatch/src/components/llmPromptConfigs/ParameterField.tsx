/**
 * ParameterField Component
 *
 * Renders an LLM parameter input based on its type (slider or select).
 * Used in LLMConfigPopover to dynamically display model-supported parameters.
 */

import {
  HStack,
  NativeSelect,
  Slider,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { ParameterConfig, SliderParameterConfig, SelectParameterConfig } from "./parameterConfig";

// ============================================================================
// Types
// ============================================================================

export type ParameterFieldProps = {
  /** Parameter name (e.g. "temperature") */
  name: string;
  /** Parameter configuration from parameterConfig */
  config: ParameterConfig;
  /** Current value */
  value: number | string | undefined;
  /** Callback when value changes */
  onChange: (value: number | string) => void;
  /** Optional max override for sliders (e.g. model's maxCompletionTokens) */
  maxOverride?: number;
  /** Whether the field is disabled */
  disabled?: boolean;
};

// ============================================================================
// Slider Field
// ============================================================================

type SliderFieldProps = {
  name: string;
  config: SliderParameterConfig;
  value: number | undefined;
  onChange: (value: number) => void;
  maxOverride?: number;
  disabled?: boolean;
};

function SliderField({
  name,
  config,
  value,
  onChange,
  maxOverride,
  disabled,
}: SliderFieldProps) {
  const effectiveMax = config.dynamicMax && maxOverride ? maxOverride : config.max;
  const currentValue = value ?? config.default;

  // Ensure current value is within bounds
  const boundedValue = Math.min(Math.max(currentValue, config.min), effectiveMax);

  return (
    <VStack gap={1} align="stretch" width="full">
      <HStack justify="space-between">
        <Text fontSize="xs" color="gray.600">
          {config.label}
        </Text>
        <Text fontSize="xs" fontWeight="medium">
          {boundedValue}
        </Text>
      </HStack>
      <Slider.Root
        size="sm"
        min={config.min}
        max={effectiveMax}
        step={config.step}
        value={[boundedValue]}
        onValueChange={(details) => onChange(details.value[0] ?? config.default)}
        disabled={disabled}
      >
        <Slider.Control>
          <Slider.Track>
            <Slider.Range />
          </Slider.Track>
          <Slider.Thumbs />
        </Slider.Control>
      </Slider.Root>
    </VStack>
  );
}

// ============================================================================
// Select Field
// ============================================================================

type SelectFieldProps = {
  name: string;
  config: SelectParameterConfig;
  value: string | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
};

function SelectField({
  name,
  config,
  value,
  onChange,
  disabled,
}: SelectFieldProps) {
  const currentValue = value ?? config.default;

  return (
    <VStack gap={1} align="stretch" width="full">
      <Text fontSize="xs" color="gray.600">
        {config.label}
      </Text>
      <NativeSelect.Root size="sm" disabled={disabled}>
        <NativeSelect.Field
          value={currentValue}
          onChange={(e) => onChange(e.target.value)}
        >
          {config.options.map((option) => (
            <option key={option} value={option}>
              {option.charAt(0).toUpperCase() + option.slice(1)}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    </VStack>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function ParameterField({
  name,
  config,
  value,
  onChange,
  maxOverride,
  disabled,
}: ParameterFieldProps) {
  if (config.type === "slider") {
    return (
      <SliderField
        name={name}
        config={config}
        value={typeof value === "number" ? value : undefined}
        onChange={onChange}
        maxOverride={maxOverride}
        disabled={disabled}
      />
    );
  }

  if (config.type === "select") {
    return (
      <SelectField
        name={name}
        config={config}
        value={typeof value === "string" ? value : undefined}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }

  // Should never happen if config is properly typed
  return null;
}

export default ParameterField;
