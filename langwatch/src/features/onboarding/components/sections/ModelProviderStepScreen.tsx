import { Button, HStack, VStack } from "@chakra-ui/react";
import type React from "react";
import { useAnalytics } from "react-contextual-analytics";
import { ModelProviderScreen } from "./ModelProviderScreen";

interface ModelProviderStepScreenProps {
  /** Advances the onboarding flow, on provider save or on skip. */
  onContinue: () => void;
}

/**
 * The "Set up a model provider" onboarding step: the shared model provider
 * screen on its onboarding surface (Codex leads with a Recommended badge),
 * plus a skip affordance since a model is never required to finish
 * onboarding.
 *
 * Spec: specs/features/onboarding/model-provider-step.feature
 */
export function ModelProviderStepScreen({
  onContinue,
}: ModelProviderStepScreenProps): React.ReactElement {
  const { emit } = useAnalytics();

  return (
    <VStack align="stretch" gap={0} w="full">
      <ModelProviderScreen variant="onboarding" onComplete={onContinue} />
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
