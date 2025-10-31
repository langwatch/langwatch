import React from "react";
import { HStack, Text, VStack } from "@chakra-ui/react";
import { FRAMEWORKS_BY_PLATFORM } from "../../../regions/observability/ui-options";
import type { FrameworkKey, PlatformKey } from "../../../regions/observability/model";
import { SelectableIconCard } from "./SelectableIconCard";

interface FrameworkGridProps {
  language: PlatformKey;
  selectedFramework: FrameworkKey | null;
  onSelectFramework: (framework: FrameworkKey) => void;
}

export function FrameworkGrid({ language, selectedFramework, onSelectFramework }: FrameworkGridProps): React.ReactElement | null {
  const frameworks = FRAMEWORKS_BY_PLATFORM[language] ;
  if (!frameworks || frameworks.length === 0) return null;

  // If no framework is selected, default to the first available framework
  const currentFramework = selectedFramework ?? frameworks[0]?.key;
  if (!currentFramework) return null;

  const framework = frameworks.find(f => f.key === currentFramework);

  return (
    <VStack align="stretch" gap={3}>
      <VStack align="stretch" gap={0}>
        <Text fontSize="md" fontWeight="semibold">
          Integrate LangWatch with {framework?.label ?? 'your selected framework'}
        </Text>
        <Text fontSize="xs" color="fg.muted">
          Pick your model provider or framework to tailor setup guide.
        </Text>
      </VStack>
      <HStack gap={3}>
        {frameworks.map((fw) => (
          <SelectableIconCard
            key={fw.key}
            label={fw.label}
            icon={fw.icon}
            selected={currentFramework === fw.key}
            onClick={() => onSelectFramework(fw.key)}
            ariaLabel={`${fw.label} framework`}
          />
        ))}
      </HStack>
    </VStack>
  );
}
