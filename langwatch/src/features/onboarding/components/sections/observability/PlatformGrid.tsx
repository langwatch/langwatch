import { HStack, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import type { PlatformKey } from "../../../regions/observability/types";
import { PLATFORM_OPTIONS } from "../../../regions/observability/ui-options";
import { SelectableIconCard } from "../shared/SelectableIconCard";

interface PlatformGridProps {
  selectedLanguage: PlatformKey;
  onSelectLanguage: (language: PlatformKey) => void;
}

export const PlatformGrid: React.FC<PlatformGridProps> = ({
  selectedLanguage,
  onSelectLanguage,
}) => {
  return (
    <VStack align="stretch" gap={3}>
      <VStack align="stretch" gap={0.5}>
        <Text fontSize="md" fontWeight="semibold" letterSpacing="-0.01em">
          Select your platform or language
        </Text>
        <Text fontSize="xs" color="fg.muted" lineHeight="tall">
          Choose the platform or language you are using to see a guide on how to
          instrument it.
        </Text>
      </VStack>
      <HStack gap={3} rowGap={4} wrap="wrap" pb={1}>
        {PLATFORM_OPTIONS.map((lang) => (
          <SelectableIconCard
            key={lang.key}
            label={lang.label}
            icon={{
              type: "single",
              src: lang.iconUrl ?? "",
              alt: lang.label,
            }}
            size="sm"
            iconSize="lg"
            selected={selectedLanguage === lang.key}
            onClick={() => onSelectLanguage(lang.key)}
            ariaLabel={`${lang.label} language`}
          />
        ))}
      </HStack>
    </VStack>
  );
};
