/**
 * The "Set up a model provider" onboarding step: the provider grid, the credential form, and a
 * skip — a model is never required to finish onboarding.
 * Spec: specs/features/onboarding/model-provider-step.feature
 */

import { Box, Button, HStack, VStack } from "@chakra-ui/react";
import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import type React from "react";
import { useState } from "react";

import type { OnboardingScreenProps } from "../../behavior/types.ts";
import {
  onboardingModelProviders,
  RECOMMENDED_ONBOARDING_PROVIDER,
} from "../../model/onboarding-model-providers.ts";
import { ModelProviderGrid } from "./model-provider/model-provider-grid.tsx";
import { ModelProviderSetup } from "./model-provider/model-provider-setup.tsx";

interface ModelProviderStepScreenProps extends OnboardingScreenProps {
  /** Advances the onboarding flow, on provider save or on skip. */
  onContinue: () => void;
}

/** The grid's leading provider, which is the recommendation itself. */
function leadingProvider(): string {
  return onboardingModelProviders()[0]?.provider ?? RECOMMENDED_ONBOARDING_PROVIDER;
}

export function ModelProviderStepScreen({
  surface,
  onContinue,
}: ModelProviderStepScreenProps): React.ReactElement {
  const analytics = useUiAnalytics();
  const [providerKey, setProviderKey] = useState<string>(leadingProvider);

  return (
    <VStack align="stretch" gap={6} w="full" mb={20}>
      <ModelProviderGrid providerKey={providerKey} onSelectProvider={setProviderKey} />

      <Box>
        <ModelProviderSetup providerKey={providerKey} onComplete={onContinue} />
      </Box>

      <HStack justify="center">
        <Button
          variant="ghost"
          size="sm"
          color="fg.subtle"
          fontWeight="semibold"
          fontSize="14px"
          borderRadius="8px"
          _hover={{ color: "fg", bg: "bg.muted" }}
          onClick={() => {
            analytics.track({
              boundary: surface.boundary,
              action: "clicked",
              name: "skip",
              attributes: surface.attributes,
            });
            onContinue();
          }}
        >
          Skip for now
        </Button>
      </HStack>
    </VStack>
  );
}
