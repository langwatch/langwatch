/**
 * Navigation component for onboarding flow
 * Single Responsibility: Renders navigation buttons with proper state management
 */

import React from "react";
import {
  HStack,
  Button,
} from "@chakra-ui/react";
import { SkipForward } from "lucide-react";

interface OnboardingNavigationProps {
  currentScreenIndex: number;
  totalScreens: number;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
  canProceed: boolean;
  isSkippable: boolean;
}

export const OnboardingNavigation: React.FC<OnboardingNavigationProps> = ({
  currentScreenIndex,
  totalScreens,
  onPrev,
  onNext,
  onSkip,
  canProceed,
  isSkippable,
}) => {
  const isFirstScreen = currentScreenIndex === 0;
  const isLastScreen = currentScreenIndex === totalScreens - 1;
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
            variant="ghost"
            onClick={onSkip}
          >
            <SkipForward size={16} />
            Skip
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
