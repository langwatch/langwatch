import React from "react";
import {
  HStack,
  Button,
  Icon,
} from "@chakra-ui/react";
import { SkipForward } from "lucide-react";
import { type OnboardingScreenIndex } from "../types/types";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { getOnboardingFlowConfig } from "../constants/onboarding-flow";

interface OnboardingNavigationProps {
  currentScreenIndex: OnboardingScreenIndex;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
  canProceed: boolean;
  isSkippable: boolean;
  isSubmitting?: boolean;
  onFinish: () => void;
}

export const OnboardingNavigation: React.FC<OnboardingNavigationProps> = ({
  currentScreenIndex,
  onPrev,
  onNext,
  onSkip,
  canProceed,
  isSkippable,
  isSubmitting = false,
  onFinish,
}) => {
  const publicEnv = usePublicEnv();
  const flow = getOnboardingFlowConfig(Boolean(publicEnv.data?.IS_SAAS));
  const isFirstScreen = currentScreenIndex === flow.first;
  const isLastScreen = currentScreenIndex === flow.last;
  const buttonText = isLastScreen ? "Finish" : "Next";

  return (
    <HStack justify="space-between" w="full">
      <Button
        visibility={isFirstScreen ? "hidden" : "visible"}
        variant="outline"
        onClick={onPrev}
        disabled={isFirstScreen}
      >
        Previous
      </Button>

      <HStack>
        {isSkippable && (
          <Button
            variant="outline"
            onClick={isLastScreen ? onFinish : onSkip}
            disabled={isSubmitting}
          >
            Skip
            <Icon size="sm">
              <SkipForward />
            </Icon>
          </Button>
        )}

        <Button
          colorPalette="orange"
          variant="solid"
          onClick={isLastScreen ? onFinish : onNext}
          disabled={!canProceed || !isLastScreen}
          loading={isSubmitting}
        >
          {buttonText}
        </Button>
      </HStack>
    </HStack>
  );
};
