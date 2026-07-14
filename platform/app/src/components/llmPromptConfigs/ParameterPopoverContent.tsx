/**
 * ParameterPopoverContent Component
 *
 * Renders the popover content for a single LLM parameter in compact mode.
 * Shows slider/input or select control with the parameter description.
 */

import { Button, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { Popover } from "../ui/popover";
import { Slider } from "../ui/slider";
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
  /** Optional max override for sliders (e.g. model's maxCompletionTokens or provider constraints) */
  maxOverride?: number;
  /** Optional min override for sliders (e.g. provider constraints) */
  minOverride?: number;
  /** Whether to render in a portal (default: true). Set false for nested popovers. */
  portalled?: boolean;
  /** Callback to close the popover (used by select controls) */
  onClose?: () => void;
};

// ============================================================================
// Slider Control
// ============================================================================

type SliderControlProps = {
  config: SliderParameterConfig;
  value: number | undefined;
  onChange: (value: number) => void;
  maxOverride?: number;
  minOverride?: number;
};

function SliderControl({
  config,
  value,
  onChange,
  maxOverride,
  minOverride,
}: SliderControlProps) {
  const {
    effectiveMin,
    effectiveMax,
    boundedValue,
    inputValue,
    handleInputChange,
    handleInputBlur,
    handleKeyDown,
  } = useSliderControl({ config, value, onChange, maxOverride, minOverride });

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
        min={effectiveMin}
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
        min={effectiveMin}
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
          <Slider.Thumb index={0}>
            <Slider.HiddenInput />
          </Slider.Thumb>
        </Slider.Control>
      </Slider.Root>
    </HStack>
  );
}

// ============================================================================
// Select Control (Button-based)
// ============================================================================

type SelectControlProps = {
  config: SelectParameterConfig;
  value: string | undefined;
  onChange: (value: string) => void;
  onClose?: () => void;
};

function SelectControl({
  config,
  value,
  onChange,
  onClose,
}: SelectControlProps) {
  const currentValue = value ?? config.default;

  const handleSelect = (option: string) => {
    onChange(option);
    onClose?.();
  };

  return (
    <VStack gap={1.5} width="full">
      {config.options.map((option) => {
        const isSelected = option === currentValue;
        return (
          <Button
            key={option}
            size="sm"
            width="full"
            variant={isSelected ? "solid" : "outline"}
            colorPalette={isSelected ? "blue" : "gray"}
            onClick={() => handleSelect(option)}
            fontWeight="medium"
            autoFocus={isSelected}
          >
            {option.charAt(0).toUpperCase() + option.slice(1)}
          </Button>
        );
      })}
    </VStack>
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
  minOverride,
  portalled = true,
  onClose,
}: ParameterPopoverContentProps) {
  const isSlider = config.type === "slider";

  return (
    <Popover.Content
      zIndex={1402}
      portalled={portalled}
      background="bg/95"
      boxShadow="lg"
      maxWidth="260px"
    >
      <VStack padding={3} gap={4} align="stretch">
        {/* For select controls: show label/description on top */}
        {!isSlider && (
          <VStack gap={1} align="stretch">
            <Text fontSize="sm" fontWeight="medium">
              {config.label}
            </Text>
            <Text fontSize="xs" color="fg.muted" lineHeight="tall">
              {config.helper}
            </Text>
          </VStack>
        )}

        {/* Control Section */}
        {isSlider ? (
          <SliderControl
            config={config}
            value={typeof value === "number" ? value : undefined}
            onChange={onChange}
            maxOverride={maxOverride}
            minOverride={minOverride}
          />
        ) : (
          <SelectControl
            config={config}
            value={typeof value === "string" ? value : undefined}
            onChange={onChange}
            onClose={onClose}
          />
        )}

        {/* For slider controls: show label/description below */}
        {isSlider && (
          <VStack gap={1} align="stretch">
            <Text fontSize="sm" fontWeight="medium">
              {config.label}
            </Text>
            <Text fontSize="xs" color="fg.muted" lineHeight="tall">
              {config.helper}
            </Text>
          </VStack>
        )}
      </VStack>
    </Popover.Content>
  );
}

export default ParameterPopoverContent;
