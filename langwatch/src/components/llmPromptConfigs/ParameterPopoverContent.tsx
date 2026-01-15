/**
 * ParameterPopoverContent Component
 *
 * Renders the popover content for a single LLM parameter in compact mode.
 * Shows slider/input or select control with the parameter description.
 */

import {
  HStack,
  Input,
  NativeSelect,
  Slider,
  Text,
  VStack,
} from "@chakra-ui/react";

import { Popover } from "../ui/popover";
import { useSliderControl } from "./hooks/useSliderControl";
import type {
  ParameterConfig,
  SelectParameterConfig,
  SliderParameterConfig,
} from "./parameterConfig";

// ============================================================================
// Types
// ============================================================================

export type ParameterPopoverContentProps = {
  /** Parameter configuration from parameterConfig */
  config: ParameterConfig;
  /** Current value */
  value: number | string | undefined;
  /** Callback when value changes */
  onChange: (value: number | string) => void;
  /** Optional max override for sliders (e.g. model's maxCompletionTokens) */
  maxOverride?: number;
  /** Whether to render in a portal (default: true). Set false for nested popovers. */
  portalled?: boolean;
};

// ============================================================================
// Slider Control
// ============================================================================

type SliderControlProps = {
  config: SliderParameterConfig;
  value: number | undefined;
  onChange: (value: number) => void;
  maxOverride?: number;
};

function SliderControl({
  config,
  value,
  onChange,
  maxOverride,
}: SliderControlProps) {
  const {
    effectiveMax,
    boundedValue,
    inputValue,
    handleInputChange,
    handleInputBlur,
    handleKeyDown,
  } = useSliderControl({ config, value, onChange, maxOverride });

  return (
    <HStack gap={3} width="full">
      <Input
        size="sm"
        width="80px"
        textAlign="center"
        type="number"
        value={inputValue}
        onChange={handleInputChange}
        onBlur={handleInputBlur}
        onKeyDown={handleKeyDown}
        min={config.min}
        max={effectiveMax}
        step={config.step}
        borderColor="blue.200"
        _focus={{
          borderColor: "blue.400",
          boxShadow: "0 0 0 1px var(--chakra-colors-blue-400)",
        }}
      />
      <Slider.Root
        flex={1}
        size="sm"
        min={config.min}
        max={effectiveMax}
        step={config.step}
        value={[boundedValue]}
        onValueChange={(details) =>
          onChange(details.value[0] ?? config.default)
        }
      >
        <Slider.Control>
          <Slider.Track>
            <Slider.Range />
          </Slider.Track>
          <Slider.Thumbs />
        </Slider.Control>
      </Slider.Root>
    </HStack>
  );
}

// ============================================================================
// Select Control
// ============================================================================

type SelectControlProps = {
  config: SelectParameterConfig;
  value: string | undefined;
  onChange: (value: string) => void;
};

function SelectControl({ config, value, onChange }: SelectControlProps) {
  const currentValue = value ?? config.default;

  return (
    <NativeSelect.Root size="sm" width="full">
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
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function ParameterPopoverContent({
  config,
  value,
  onChange,
  maxOverride,
  portalled = true,
}: ParameterPopoverContentProps) {
  return (
    <Popover.Content
      zIndex={1402}
      portalled={portalled}
      background="white/95"
      boxShadow="lg"
    >
      <VStack padding={4} gap={3} align="stretch">
        {/* Control Section */}
        {config.type === "slider" ? (
          <SliderControl
            config={config}
            value={typeof value === "number" ? value : undefined}
            onChange={onChange}
            maxOverride={maxOverride}
          />
        ) : (
          <SelectControl
            config={config}
            value={typeof value === "string" ? value : undefined}
            onChange={onChange}
          />
        )}

        {/* Label */}
        <Text fontSize="sm" fontWeight="medium">
          {config.label}
        </Text>

        {/* Description */}
        <Text fontSize="xs" color="gray.500" lineHeight="tall">
          {config.helper}
        </Text>
      </VStack>
    </Popover.Content>
  );
}

export default ParameterPopoverContent;
