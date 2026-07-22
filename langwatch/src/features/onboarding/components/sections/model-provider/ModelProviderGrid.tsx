import { HStack, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import {
  getModelProvider,
  modelProviderRegistry,
} from "~/features/onboarding/regions/model-providers/registry";
import type { ModelProviderKey } from "~/features/onboarding/regions/model-providers/types";
import { SelectableIconCard } from "../shared/SelectableIconCard";

interface ModelProviderGridProps {
  variant: "evaluations" | "prompts" | "langy";
  modelProviderKey: ModelProviderKey;
  onSelectModelProvider: (modelProvider: ModelProviderKey) => void;
}

const variantDescriptions: Record<"evaluations" | "prompts" | "langy", string> =
  {
    evaluations:
      "We'll use this model to run your evaluations, and show you where your interactions shines, and where it doesn't.",
    prompts:
      "We'll use this model when you run evaluations on your datasets, in your traces, or analyze responses after they happen.",
    langy:
      "Langy uses this model to chat with you and help you work across the platform. Pick a provider and add your key to get started.",
  };

export function ModelProviderGrid({
  variant,
  modelProviderKey,
  onSelectModelProvider,
}: ModelProviderGridProps): React.ReactElement | null {
  const modelProvider = getModelProvider(modelProviderKey);
  // The Langy panel already leads with its own "needs a model" heading, and
  // its column is a third the width of an onboarding page: no second heading,
  // and compact cards so the grid doesn't dwarf the panel.
  const isCompact = variant === "langy";

  return (
    <VStack align="stretch" gap={3}>
      <VStack align="stretch" gap={0}>
        {!isCompact && (
          <Text fontSize="md" fontWeight="semibold">
            Give LangWatch access to{" "}
            {modelProvider?.label ?? "selected model provider"}
          </Text>
        )}
        <Text fontSize="xs" color="fg.muted">
          {variantDescriptions[variant]}
        </Text>
      </VStack>
      <HStack gap={isCompact ? 2 : 3} wrap="wrap">
        {modelProviderRegistry.map((mp) => (
          <SelectableIconCard
            key={mp.key}
            label={mp.label}
            size={isCompact ? "sm" : "md"}
            iconSize={isCompact ? "lg" : "2xl"}
            icon={mp.icon}
            selected={mp.key === modelProviderKey}
            onClick={() => onSelectModelProvider(mp.key)}
            ariaLabel={mp.label}
          />
        ))}
      </HStack>
    </VStack>
  );
}
