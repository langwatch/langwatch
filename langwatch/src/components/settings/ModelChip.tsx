/**
 * Renders a model identifier ("openai/gpt-5.5") with the provider's
 * icon and the family name in mono font — the same primitive
 * `ProviderModelSelector` uses inside its dropdown items. Used in the
 * Default Models table cells and in the override drawer so the page
 * reads consistent with the model-provider list above it.
 */
import { Box, HStack, Text } from "@chakra-ui/react";
import { AlertTriangle } from "lucide-react";
import { Tooltip } from "../ui/tooltip";
import { modelProviderIcons } from "~/server/modelProviders/iconsMap";
import {
  isLatestAlias,
  resolveLatestAlias,
} from "~/server/modelProviders/latestAliases";
import {
  MODEL_ICON_SIZE,
  MODEL_ICON_SIZE_SM,
} from "../llmPromptConfigs/constants";

interface Props {
  /** Full model id of the form "provider/family-variant". */
  model: string;
  size?: "sm" | "md";
  /** When true, renders at reduced opacity to signal "inherited / placeholder". */
  inherited?: boolean;
  /** When true, renders a warning treatment + tooltip: the model's
   *  provider isn't enabled in the current cascade, so any AI feature
   *  reading this default will fail at runtime until the user re-adds
   *  the provider or picks a different model. */
  invalid?: boolean;
}

export function ModelChip({
  model,
  size = "md",
  inherited = false,
  invalid = false,
}: Props) {
  const providerKey = model.split("/")[0] ?? "";
  const family = model.split("/").slice(1).join("/");
  const icon =
    modelProviderIcons[providerKey as keyof typeof modelProviderIcons];
  const iconSlot = size === "sm" ? MODEL_ICON_SIZE_SM : MODEL_ICON_SIZE;
  // Alias rendering: `openai/latest` shows as "Latest (gpt-5.5)" with
  // the resolved concrete id inline in muted text so the table reads
  // as a single line, parens-disambiguated, instead of a stacked pair.
  const aliasResolved = isLatestAlias(model) ? resolveLatestAlias(model) : null;
  const aliasLabel =
    isLatestAlias(model)
      ? family === "latest"
        ? "Latest"
        : "Latest smaller"
      : null;

  const chip = (
    <HStack
      gap={2}
      opacity={inherited ? 0.55 : 1}
      data-testid={`model-chip-${model}`}
      data-invalid={invalid || undefined}
    >
      {icon && (
        <Box minWidth={iconSlot} width={iconSlot}>
          {icon}
        </Box>
      )}
      {aliasLabel ? (
        <Text
          fontSize={size === "sm" ? "xs" : "sm"}
          lineClamp={1}
          color={invalid ? "red.600" : undefined}
          textDecoration={invalid ? "line-through" : undefined}
        >
          <Text as="span" fontWeight="medium">
            {aliasLabel}
          </Text>
          {aliasResolved && (
            <Text
              as="span"
              color={invalid ? undefined : "fg.muted"}
              fontFamily="mono"
            >
              {" "}
              ({aliasResolved.split("/").slice(1).join("/")})
            </Text>
          )}
        </Text>
      ) : (
        <Text
          fontFamily="mono"
          fontSize={size === "sm" ? "xs" : "sm"}
          lineClamp={1}
          wordBreak="break-all"
          color={invalid ? "red.600" : undefined}
          textDecoration={invalid ? "line-through" : undefined}
        >
          {family || model}
        </Text>
      )}
      {invalid && (
        <HStack gap={1} color="red.600" flexShrink={0}>
          <AlertTriangle size={size === "sm" ? 12 : 14} aria-hidden />
          <Text
            fontSize={size === "sm" ? "2xs" : "xs"}
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

  if (!invalid) return chip;

  return (
    <Tooltip
      content={`${providerKey} provider isn't enabled here. AI features reading this default will fail until you re-add it or pick a different model.`}
      positioning={{ placement: "top" }}
      showArrow
    >
      <Box>{chip}</Box>
    </Tooltip>
  );
}
