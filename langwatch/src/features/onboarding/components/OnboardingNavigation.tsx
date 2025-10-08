import React from "react";
import {
  HStack,
  Button,
  Icon,
} from "@chakra-ui/react";
import { SkipForward } from "lucide-react";
import { ONBOARDING_SCREENS, type OnboardingScreenIndex } from "../types/types";

interface OnboardingNavigationProps {
  currentScreenIndex: OnboardingScreenIndex;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
  canProceed: boolean;
  isSkippable: boolean;
}

export const OnboardingNavigation: React.FC<OnboardingNavigationProps> = ({
  currentScreenIndex,
  onPrev,
  onNext,
  onSkip,
  canProceed,
  isSkippable,
}) => {
  const isFirstScreen = currentScreenIndex === ONBOARDING_SCREENS.FIRST;
  const isLastScreen = currentScreenIndex === ONBOARDING_SCREENS.LAST;
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
            onClick={onSkip}
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
          onClick={onNext}
          disabled={!canProceed || isLastScreen}
        >
          {buttonText}
        </Button>
      </HStack>
    </HStack>
  );
};
