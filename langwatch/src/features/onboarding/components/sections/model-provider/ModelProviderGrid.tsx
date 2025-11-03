import React from "react";
import { HStack, Text, VStack } from "@chakra-ui/react";
import { SelectableIconCard } from "../shared/SelectableIconCard";
import { getModelProvider, modelProviderRegistry } from "~/features/onboarding/regions/model-providers/registry";
import type { ModelProviderKey } from "~/features/onboarding/regions/model-providers/types";

interface ModelProviderGridProps {
  modelProviderKey: ModelProviderKey;
  onSelectModelProvider: (modelProvider: ModelProviderKey) => void;
}

export function ModelProviderGrid({
  modelProviderKey,
  onSelectModelProvider,
}: ModelProviderGridProps): React.ReactElement | null {
  const modelProvider = getModelProvider(modelProviderKey);

  return (
    <VStack align="stretch" gap={3}>
      <VStack align="stretch" gap={0}>
        <Text fontSize="md" fontWeight="semibold">
          Give LangWatch access to your {" "}
          {modelProvider?.label ?? "selected model provider"}
        </Text>
        <Text fontSize="xs" color="fg.muted">
          Pick the relevant model provider. You can add more later in the project settings.
        </Text>
      </VStack>
      <HStack gap={3} wrap="wrap">
        {modelProviderRegistry.map(mp => (
          <SelectableIconCard
            key={mp.key}
            label={mp.label}
            iconSize="2xl"
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
