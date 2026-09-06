import { HStack, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import type { PlatformKey } from "../../../regions/observability/types";
import { PLATFORM_OPTIONS } from "../../../regions/observability/ui-options";
import { SelectableIconCard } from "../shared/SelectableIconCard";

type PlatformOption = (typeof PLATFORM_OPTIONS)[number];

interface PlatformGridProps {
  selectedLanguage: PlatformKey;
  onSelectLanguage: (language: PlatformKey) => void;
  /**
   * Override the platform list. The traces-v2 empty-state onboarding passes
   * a category-filtered subset; the original onboarding flow falls through
   * to the full PLATFORM_OPTIONS.
   */
  platforms?: readonly PlatformOption[];
}

export const PlatformGrid: React.FC<PlatformGridProps> = ({
  selectedLanguage,
  onSelectLanguage,
  platforms = PLATFORM_OPTIONS,
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
        {platforms.map((lang) => (
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
