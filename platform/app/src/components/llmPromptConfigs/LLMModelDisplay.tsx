import { Box, HStack, type StackProps, Text, VStack } from "@chakra-ui/react";
import { AlertTriangle } from "lucide-react";

import {
  type modelProviderIcons,
  ProviderIconGlyph,
} from "~/components/modelProviders/iconsMap";
import { allModelOptions, useModelSelectionOptions } from "../ModelSelector";
import { OverflownTextWithTooltip } from "../OverflownText";
import { Tooltip } from "../ui/tooltip";
import { MODEL_ICON_SIZE } from "./constants";

export interface LLMModelDisplayProps extends StackProps {
  model: string;
  fontSize?: string;
  /** Optional subtitle to display below the model name (e.g., "Temp 0.7") */
  subtitle?: string;
  /**
   * Size of the provider mark. Defaults to MODEL_ICON_SIZE, which is what the
   * model tables and pickers use; the compact selector in the prompt editor
   * passes MODEL_ICON_SIZE_SM so the mark does not outweigh the model name it
   * sits beside.
   */
  iconSize?: string;
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
  iconSize = MODEL_ICON_SIZE,
  ...props
}: LLMModelDisplayProps) {
  const { modelOption, groupedByProvider, isLoading } =
    useModelSelectionOptions(allModelOptions, model, "chat");

  // Model is disabled if explicitly marked or if provider is disabled
  const isDisabled = modelOption?.isDisabled ?? false;

  // Invalid = model points at a provider that's not enabled for this
  // project (deleted, scope dropped, or never configured). The
  // evaluator / prompt config still carries the stored id, but the
  // resolver will fail on it at runtime. Render the same red strike +
  // AlertTriangle + tooltip pattern the Default Models table uses.
  // Skip the warning while the providers query is in flight to avoid
  // flashing a false-positive before data resolves.
  const providerKey = model.split("/")[0] ?? "";
  const isProviderMissing =
    !!model &&
    !isLoading &&
    groupedByProvider.length > 0 &&
    !groupedByProvider.some((g) => g.provider === providerKey);
  // The mark is drawn from the model's own provider key rather than from
  // `modelOption?.icon`, which is the bare SVG: those marks are flat black, so
  // on the dark theme they landed all but invisible. `ProviderIconGlyph` is the
  // shared wrapper that inverts the monochrome ones and leaves brand-coloured
  // marks alone, and it is the same lookup, so it also keeps showing the right
  // mark when the provider row is gone (`modelOption` is null then).
  const hasIcon = !!modelOption?.icon || isProviderMissing;

  const stack = (
    <HStack align="center" gap={2} {...props}>
      {hasIcon && (
        <ProviderIconGlyph
          provider={providerKey as keyof typeof modelProviderIcons}
          size={iconSize}
        />
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
          color={
            isProviderMissing ? "red.600" : isDisabled ? "fg.muted" : undefined
          }
          textDecoration={
            isProviderMissing || isDisabled ? "line-through" : undefined
          }
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
        <HStack gap={1} color="red.600" flexShrink={0}>
          <AlertTriangle size={14} aria-hidden />
          <Text
            fontSize="xs"
            fontWeight="medium"
            textTransform="uppercase"
            letterSpacing="wide"
          >
            Update needed
          </Text>
        </HStack>
      )}
    </HStack>
  );

  if (!isProviderMissing) return stack;

  return (
    <Tooltip
      content={`${providerKey} provider isn't enabled here. Re-add the provider or pick a different model to use it.`}
      positioning={{ placement: "top" }}
      showArrow
    >
      <Box>{stack}</Box>
    </Tooltip>
  );
}
