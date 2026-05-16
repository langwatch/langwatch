/**
 * Renders a model identifier ("openai/gpt-5.5") with the provider's
 * icon and the family name in mono font — the same primitive
 * `ProviderModelSelector` uses inside its dropdown items. Used in the
 * Default Models table cells and in the override drawer so the page
 * reads consistent with the model-provider list above it.
 */
import { Box, HStack, Text } from "@chakra-ui/react";
import { modelProviderIcons } from "~/server/modelProviders/iconsMap";
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
}

export function ModelChip({ model, size = "md", inherited = false }: Props) {
  const providerKey = model.split("/")[0] ?? "";
  const family = model.split("/").slice(1).join("/");
  const icon =
    modelProviderIcons[providerKey as keyof typeof modelProviderIcons];
  const iconSlot = size === "sm" ? MODEL_ICON_SIZE_SM : MODEL_ICON_SIZE;

  return (
    <HStack
      gap={2}
      opacity={inherited ? 0.55 : 1}
      data-testid={`model-chip-${model}`}
    >
      {icon && (
        <Box minWidth={iconSlot} width={iconSlot}>
          {icon}
        </Box>
      )}
      <Text
        fontFamily="mono"
        fontSize={size === "sm" ? "xs" : "sm"}
        lineClamp={1}
        wordBreak="break-all"
      >
        {family || model}
      </Text>
    </HStack>
  );
}
