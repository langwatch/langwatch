import React from "react";
import { Grid, Text, VStack } from "@chakra-ui/react";
import { FRAMEWORKS_BY_PLATFORM } from "./constants";
import type { FrameworkKey, PlatformKey, Option } from "./types";
import { SelectableIconCard } from "./SelectableIconCard";

interface FrameworkGridProps {
  language: PlatformKey;
  selectedFramework: FrameworkKey | null;
  onSelectFramework: (framework: FrameworkKey) => void;
}

export function FrameworkGrid({ language, selectedFramework, onSelectFramework }: FrameworkGridProps): React.ReactElement | null {
  const frameworks = FRAMEWORKS_BY_PLATFORM[language] as readonly Option<FrameworkKey>[];
  if (!frameworks || frameworks.length === 0) return null;

  return (
    <VStack align="stretch" gap={3}>
      <VStack align="stretch" gap={0}>
        <Text fontSize="md" fontWeight="semibold">
          Select a framework/provider
        </Text>
        <Text fontSize="xs" color="fg.muted">
          Pick your model provider or framework to tailor setup guide.
        </Text>
      </VStack>
      <Grid templateColumns={{ base: "repeat(4, 1fr)", md: "repeat(8, 1fr)" }} gap={3}>
        {frameworks.map((fw) => (
          <SelectableIconCard
            key={fw.key}
            label={fw.label}
            icon={fw.icon}
            size={fw.size}
            selected={selectedFramework === fw.key}
            onClick={() => onSelectFramework(fw.key)}
            ariaLabel={`${fw.label} framework`}
          />
        ))}
      </Grid>
    </VStack>
  );
}


