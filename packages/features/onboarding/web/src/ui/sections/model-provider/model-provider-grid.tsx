/**
 * The provider picker for the onboarding step: one card per provider, the
 * recommended one first and badged. The badge folds into the card's accessible
 * name, so assistive technology hears the recommendation sighted readers see.
 */

import { HStack, Text, VStack } from "@chakra-ui/react";
import { modelProviderIcons } from "@langwatch/model-provider-web/components/modelProviders/iconsMap";
import type React from "react";
import { useMemo } from "react";
import {
  onboardingModelProviders,
  type OnboardingModelProvider,
} from "../../../model/onboarding-model-providers";
import { SelectableIconCard } from "../../elements/shared/selectable-icon-card";

export const ONBOARDING_MODEL_PROVIDER_DESCRIPTION =
  "The model LangWatch's AI assistant and AI assists run on. You can add more providers later in Settings.";

interface ModelProviderGridProps {
  providerKey: string;
  onSelectProvider: (provider: string) => void;
}

export function ModelProviderGrid({
  providerKey,
  onSelectProvider,
}: ModelProviderGridProps): React.ReactElement {
  const providers: OnboardingModelProvider[] = useMemo(() => onboardingModelProviders(), []);
  const selected = providers.find((candidate) => candidate.provider === providerKey);

  return (
    <VStack align="stretch" gap={3}>
      <VStack align="stretch" gap={0}>
        <Text fontSize="md" fontWeight="semibold">
          Give LangWatch access to {selected?.name ?? "a model provider"}
        </Text>
        <Text fontSize="xs" color="fg.muted">
          {ONBOARDING_MODEL_PROVIDER_DESCRIPTION}
        </Text>
      </VStack>
      <HStack gap={3} wrap="wrap">
        {providers.map((provider) => (
          <SelectableIconCard
            key={provider.provider}
            label={provider.name}
            iconSize="2xl"
            iconNode={modelProviderIcons[provider.provider as keyof typeof modelProviderIcons]}
            selected={provider.provider === providerKey}
            onClick={() => onSelectProvider(provider.provider)}
            ariaLabel={provider.name}
            badge={provider.recommended ? "Recommended" : undefined}
          />
        ))}
      </HStack>
    </VStack>
  );
}
