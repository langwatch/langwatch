import { Box, HStack, type StackProps, Text, VStack } from "@chakra-ui/react";

import { allModelOptions, useModelSelectionOptions } from "../ModelSelector";
import { OverflownTextWithTooltip } from "../OverflownText";
import { MODEL_ICON_SIZE } from "./constants";

export interface LLMModelDisplayProps extends StackProps {
  model: string;
  fontSize?: string;
  /** Optional subtitle to display below the model name (e.g., "Temp 0.7") */
  subtitle?: string;
}

/**
 * LLM Model Display
 * Shows the model name with provider icon and optional parameter subtitle.
 * Can be used outside of the form context (does not use react-hook-form)
 */
export function LLMModelDisplay({
  model,
  fontSize = "14px",
  subtitle,
  ...props
}: LLMModelDisplayProps) {
  const { modelOption } = useModelSelectionOptions(
    allModelOptions,
    model,
    "chat",
  );

  // Model is disabled if explicitly marked or if provider is disabled
  const isDisabled = modelOption?.isDisabled ?? false;
  // Unknown model (not in our list) - still show it but don't mark as deprecated
  const _isUnknown = !modelOption?.label;

  return (
    <HStack align="center" gap={2} {...props}>
      {modelOption?.icon && (
        <Box width={MODEL_ICON_SIZE} minWidth={MODEL_ICON_SIZE}>
          {modelOption.icon}
        </Box>
      )}
      <VStack gap={0} align="start">
        <OverflownTextWithTooltip
          label={
            isDisabled
              ? `${modelOption?.label ?? model} (disabled)`
              : (modelOption?.label ?? model)
          }
          fontSize={fontSize}
          fontFamily="mono"
          lineClamp={1}
          wordBreak="break-all"
          color={isDisabled ? "gray.500" : undefined}
          textDecoration={isDisabled ? "line-through" : undefined}
        >
          {modelOption?.label ?? model}
        </OverflownTextWithTooltip>
        {subtitle && (
          <Text fontSize="xs" color="gray.500" lineClamp={1}>
            {subtitle}
          </Text>
        )}
      </VStack>
    </HStack>
  );
}
