import React from "react";
import { Grid, Text, VStack } from "@chakra-ui/react";
import { PLATFORM_OPTIONS } from "./constants";
import type { PlatformKey } from "./types";
import { SelectableIconCard } from "./SelectableIconCard";

interface PlatformGridProps {
  selectedLanguage: PlatformKey;
  onSelectLanguage: (language: PlatformKey) => void;
}

export const PlatformGrid: React.FC<PlatformGridProps> = ({
  selectedLanguage,
  onSelectLanguage
}) => {
  return (
    <VStack align="stretch" gap={3}>
      <VStack align="stretch" gap={0}>
        <Text fontSize="md" fontWeight="semibold">
          Select your platform or language
        </Text>
        <Text fontSize="xs" color="fg.muted">
          Choose the language or platform you want to instrument. You can add others later.
        </Text>
      </VStack>
      <Grid templateColumns={{ base: "repeat(4, 1fr)", md: "repeat(8, 1fr)" }} gap={3}>
        {PLATFORM_OPTIONS.map((lang) => (
          <SelectableIconCard
            key={lang.key}
            label={lang.label}
            icon={lang.icon}
            selected={selectedLanguage === lang.key}
            onClick={() => onSelectLanguage(lang.key)}
            ariaLabel={`${lang.label} language`}
          />
        ))}
      </Grid>
    </VStack>
  );
}
