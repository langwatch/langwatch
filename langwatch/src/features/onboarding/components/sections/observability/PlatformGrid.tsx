import React from "react";
import { HStack, Text, VStack } from "@chakra-ui/react";
import { PLATFORM_OPTIONS } from "../../../regions/observability/ui-options";
import type { PlatformKey } from "../../../regions/observability/types";
import { SelectableIconCard } from "../shared/SelectableIconCard";

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
          Choose the platform or language you are using to see a guide on how to instrument it.
        </Text>
      </VStack>
      <HStack gap={3} wrap="wrap">
        {PLATFORM_OPTIONS.map((lang) => (
          <SelectableIconCard
            key={lang.key}
            label={lang.label}
            icon={{
              type: "single",
              src: lang.iconUrl ?? "",
              alt: lang.label,
            }}
            iconSize="lg"
            selected={selectedLanguage === lang.key}
            onClick={() => onSelectLanguage(lang.key)}
            ariaLabel={`${lang.label} language`}
          />
        ))}
      </HStack>
  </VStack>
  );
}
