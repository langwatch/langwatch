/**
 * The "Set up a model provider" onboarding step: the provider grid, the credential form, and a
 * skip — a model is never required to finish onboarding.
 * Spec: specs/features/onboarding/model-provider-step.feature
 */

import { Box, Button, HStack, VStack } from "@chakra-ui/react";
import type React from "react";
import { useState } from "react";
import { useAnalytics } from "react-contextual-analytics";
import {
  onboardingModelProviders,
  RECOMMENDED_ONBOARDING_PROVIDER,
} from "../../model/onboarding-model-providers";
import { ModelProviderGrid } from "./model-provider/model-provider-grid";
import { ModelProviderSetup } from "./model-provider/model-provider-setup";

interface ModelProviderStepScreenProps {
  /** Advances the onboarding flow, on provider save or on skip. */
  onContinue: () => void;
}

/** The grid's leading provider, which is the recommendation itself. */
function leadingProvider(): string {
  return onboardingModelProviders()[0]?.provider ?? RECOMMENDED_ONBOARDING_PROVIDER;
}

export function ModelProviderStepScreen({
  onContinue,
}: ModelProviderStepScreenProps): React.ReactElement {
  const { emit } = useAnalytics();
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
            emit("clicked", "skip");
            onContinue();
          }}
        >
          Skip for now
        </Button>
      </HStack>
    </VStack>
  );
}
