/**
 * A model identifier ("openai/gpt-5.5") with the provider's mark and the family
 * name in mono.
 *
 * Moved whole from `platform/app/src/components/settings/ModelChip.tsx`, whose
 * only consumers were the Default Models table and its own test. The two icon
 * sizes were `~/components/llmPromptConfigs/constants`, which keeps eleven
 * non-family callers; two string constants are cheaper to state here than to
 * reach for.
 */

import { Box, HStack, Text } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import {
  isLatestAlias,
  modelDisplayLabel,
  resolveLatestAlias,
} from "@langwatch/model-provider-contract";
import { AlertTriangle } from "lucide-react";
import { modelProviderIcons } from "./model-provider-icons.tsx";

const MODEL_ICON_SIZE = "16px";
const MODEL_ICON_SIZE_SM = "14px";

interface Props {
  /** Full model id of the form "provider/family-variant". */
  model: string;
  size?: "sm" | "md";
  /** When true, renders at reduced opacity to signal "inherited / placeholder". */
  inherited?: boolean;
  /** When true, renders a warning treatment + tooltip: the model's provider
   *  isn't enabled in the current cascade, so any AI feature reading this
   *  default will fail at runtime until the user re-adds the provider or picks
   *  a different model. */
  invalid?: boolean;
  /** Configured custom-model display names, keyed by `<provider>/<modelId>`.
   *  Falls back to the id-derived family name for any model without an entry. */
  displayNames?: Record<string, string>;
}

// Alias detection reads the id, never the display label — a custom model can
// carry any name, and branching on it would let one named "latest" masquerade
// as the alias (and vice versa).
function aliasKindLabel(model: string): string | null {
  if (!isLatestAlias(model)) return null;
  const idFamily = model.split("/").slice(1).join("/");

  return idFamily === "latest" ? "Latest" : "Latest smaller";
}

/**
 * Alias rendering: `openai/latest` shows as "Latest (gpt-5.5)" with the
 * resolved concrete id inline in muted text so the table reads as a single
 * line, parens-disambiguated, instead of a stacked pair.
 */
function AliasLabel({
  aliasLabel,
  aliasResolved,
  fontSize,
  invalid,
}: {
  aliasLabel: string;
  aliasResolved: string | null;
  fontSize: string;
  invalid: boolean;
}) {
  return (
    <Text
      fontSize={fontSize}
      lineClamp={1}
      color={invalid ? "red.600" : undefined}
      textDecoration={invalid ? "line-through" : undefined}
    >
      <Text as="span" fontWeight="medium">
        {aliasLabel}
      </Text>
      {aliasResolved && (
        <Text as="span" color={invalid ? undefined : "fg.muted"} fontFamily="mono">
          {" "}
          ({aliasResolved.split("/").slice(1).join("/")})
        </Text>
      )}
    </Text>
  );
}

function ModelLabel({
  fontSize,
  invalid,
  label,
}: {
  fontSize: string;
  invalid: boolean;
  label: string;
}) {
  return (
    <Text
      fontFamily="mono"
      fontSize={fontSize}
      lineClamp={1}
      wordBreak="break-all"
      color={invalid ? "red.600" : undefined}
      textDecoration={invalid ? "line-through" : undefined}
    >
      {label}
    </Text>
  );
}

function UpdateNeededBadge({ size }: { size: "sm" | "md" }) {
  const isSmall = size === "sm";

  return (
    <HStack gap={1} color="red.600" flexShrink={0}>
      <AlertTriangle size={isSmall ? 12 : 14} aria-hidden />
      <Text
        fontSize={isSmall ? "2xs" : "xs"}
        fontWeight="medium"
        textTransform="uppercase"
        letterSpacing="wide"
      >
        Update needed
      </Text>
    </HStack>
  );
}

export function ModelChip({
  model,
  size = "md",
  inherited = false,
  invalid = false,
  displayNames,
}: Props) {
  const providerKey = model.split("/")[0] ?? "";
  const family = modelDisplayLabel({ fullModelId: model, displayNames });
  const icon = modelProviderIcons[providerKey as keyof typeof modelProviderIcons];
  const iconSlot = size === "sm" ? MODEL_ICON_SIZE_SM : MODEL_ICON_SIZE;
  const fontSize = size === "sm" ? "xs" : "sm";
  const aliasResolved = isLatestAlias(model) ? resolveLatestAlias(model) : null;
  const aliasLabel = aliasKindLabel(model);

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
        <AliasLabel
          aliasLabel={aliasLabel}
          aliasResolved={aliasResolved}
          fontSize={fontSize}
          invalid={invalid}
        />
      ) : (
        <ModelLabel fontSize={fontSize} invalid={invalid} label={family || model} />
      )}
      {invalid && <UpdateNeededBadge size={size} />}
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
