import { OverflownTextWithTooltip } from "@langwatch/design-system/overflown-text";
import { Box, HStack, type StackProps, Text, VStack } from "@langwatch/design-system/primitives";
import { inferProvider, ProviderIconGlyph } from "@langwatch/design-system/provider-icons";
import { Tooltip } from "@langwatch/design-system/tooltip";
import {
  allModelOptions,
  type BuiltInModel,
  isServedOnlyAsBuiltIn,
  unavailableModelReason,
} from "@langwatch/model-provider-contract";
import { MODEL_ICON_SIZE } from "@langwatch/prompt-contract/llm-config-constants";
import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

import { useModelSelectionOptions } from "./model-selector.tsx";

export interface LLMModelDisplayProps extends StackProps {
  model: string;
  fontSize?: string;
  /** Optional subtitle to display below the model name (e.g., "Temp 0.7") */
  subtitle?: string;
  /** Built-in models the chosen one may be, so it reads by its label. */
  builtInModels?: readonly BuiltInModel[];
}

function getModelDisplayState({
  model,
  isLoading,
  groupedByProvider,
  modelOption,
}: {
  model: string;
  isLoading: boolean;
  groupedByProvider: { provider: string }[];
  modelOption:
    | { icon?: ReactNode; isDisabled?: boolean; label?: string; isBuiltIn?: boolean }
    | undefined;
}) {
  const providerKey = model.split("/")[0] ?? "";
  const isProviderMissing =
    !!model &&
    !isLoading &&
    !modelOption?.isBuiltIn &&
    (isServedOnlyAsBuiltIn(model) ||
      (groupedByProvider.length > 0 && !groupedByProvider.some((g) => g.provider === providerKey)));
  // The inferred mark is dark-safe and covers bare ids ("gpt-5-mini") the options miss.
  const provider = inferProvider(model);
  const iconNode = provider ? (
    <ProviderIconGlyph provider={provider} size={MODEL_ICON_SIZE} />
  ) : (
    modelOption?.icon
  );

  return { iconNode, isProviderMissing };
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
  builtInModels,
  ...props
}: LLMModelDisplayProps) {
  const { modelOption, groupedByProvider, isLoading } = useModelSelectionOptions({
    options: allModelOptions,
    model,
    mode: "chat",
    builtInModels,
  });

  // Model is disabled if explicitly marked or if provider is disabled
  const isDisabled = modelOption?.isDisabled ?? false;

  // Invalid = the project cannot run this model: its provider is not enabled here, or it is a
  // decision model the picker no longer offers. Same red strike and AlertTriangle the Default
  // Models table uses, skipped while the providers query is in flight so nothing flashes.
  const { iconNode, isProviderMissing } = getModelDisplayState({
    model,
    isLoading,
    groupedByProvider,
    modelOption,
  });

  const disabledColor = isDisabled ? "fg.muted" : undefined;
  const labelColor = isProviderMissing ? "red.fg" : disabledColor;

  const stack = (
    <HStack align="center" gap={2} {...props}>
      {iconNode && (
        <Box width={MODEL_ICON_SIZE} minWidth={MODEL_ICON_SIZE}>
          {iconNode}
        </Box>
      )}
      <VStack gap={0} align="start">
        <OverflownTextWithTooltip
          label={
            isDisabled ? `${modelOption?.label ?? model} (disabled)` : (modelOption?.label ?? model)
          }
          fontSize={fontSize}
          fontFamily="mono"
          lineClamp={1}
          wordBreak="break-all"
          color={labelColor}
          textDecoration={isProviderMissing || isDisabled ? "line-through" : undefined}
        >
          {modelOption?.label ?? model}
        </OverflownTextWithTooltip>
        {subtitle && (
          <Text fontSize="xs" color="fg.muted" lineClamp={1}>
            {subtitle}
          </Text>
        )}
      </VStack>
      {isProviderMissing && (
        <HStack gap={1} color="red.fg" flexShrink={0}>
          <AlertTriangle size={14} aria-hidden />
          <Text fontSize="xs" fontWeight="medium" textTransform="uppercase" letterSpacing="wide">
            Update needed
          </Text>
        </HStack>
      )}
    </HStack>
  );

  if (!isProviderMissing) return stack;

  return (
    <Tooltip
      content={unavailableModelReason({ model })}
      positioning={{ placement: "top" }}
      showArrow
    >
      <Box>{stack}</Box>
    </Tooltip>
  );
}
