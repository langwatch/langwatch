/**
 * ParameterRow Component
 *
 * Renders a compact clickable row for an LLM parameter that opens a popover
 * with the parameter controls and description when clicked.
 */

import { Box, HStack, Text } from "@chakra-ui/react";

import { uppercaseFirstLetter } from "~/utils/stringCasing";
import { Popover } from "../ui/popover";
import { ParameterPopoverContent } from "./ParameterPopoverContent";
import { getParameterIcon, type ParameterConfig } from "./parameterConfig";

// ============================================================================
// Types
// ============================================================================

export type ParameterRowProps = {
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
  /** Controlled open state */
  isOpen: boolean;
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void;
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format a parameter value for display
 */
function formatParameterValue(
  value: number | string | undefined,
  config: ParameterConfig,
): string {
  const displayValue = value ?? config.default;

  // Handle undefined/null values early
  if (displayValue === undefined || displayValue === null) {
    return "";
  }

  if (typeof displayValue === "number") {
    // Format to reasonable precision
    return Number.isInteger(displayValue)
      ? String(displayValue)
      : displayValue.toFixed(2).replace(/\.?0+$/, "");
  }

  // Capitalize first letter for select values
  return uppercaseFirstLetter(String(displayValue));
}

// ============================================================================
// Main Component
// ============================================================================

export function ParameterRow({
  name,
  config,
  value,
  onChange,
  maxOverride,
  disabled,
  isOpen,
  onOpenChange,
}: ParameterRowProps) {
  const iconConfig = getParameterIcon(name);
  const IconComponent = iconConfig.icon;
  const displayValue = formatParameterValue(value, config);

  return (
    <Popover.Root
      open={isOpen}
      onOpenChange={({ open }) => onOpenChange(open)}
      positioning={{ placement: "right-start" }}
    >
      <Popover.Trigger asChild disabled={disabled}>
        <HStack
          width="full"
          paddingY={2}
          paddingX={3}
          borderRadius="md"
          border="1px solid"
          borderColor="border"
          cursor={disabled ? "not-allowed" : "pointer"}
          opacity={disabled ? 0.5 : 1}
          _hover={disabled ? {} : { bg: "bg.subtle" }}
          transition="background 0.15s"
          data-testid={`parameter-row-${name}`}
        >
          <Box
            display="flex"
            alignItems="center"
            justifyContent="center"
            width="16px"
            height="16px"
            color="fg.muted"
          >
            <IconComponent size={16} />
          </Box>
          <Text fontSize="sm" fontWeight="medium" flex={1}>
            {config.label}
          </Text>
          <Text fontSize="sm" color="fg.muted">
            {displayValue}
          </Text>
        </HStack>
      </Popover.Trigger>
      <ParameterPopoverContent
        config={config}
        value={value}
        onChange={onChange}
        maxOverride={maxOverride}
        portalled={false}
      />
    </Popover.Root>
  );
}

export default ParameterRow;
