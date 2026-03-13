import { Button, HStack, Icon, VStack } from "@chakra-ui/react";
import { SkipForward } from "lucide-react";
import React from "react";
import { useAnalytics } from "react-contextual-analytics";

interface OnboardingNavigationProps<T extends number = number> {
  currentScreenIndex: T;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
  canProceed: boolean;
  isSkippable: boolean;
  isSubmitting?: boolean;
  onFinish: () => void;
  isFirstScreen?: boolean;
  isLastScreen?: boolean;
}

export const OnboardingNavigation = <T extends number = number>({
  currentScreenIndex,
  onPrev,
  onNext,
  onSkip,
  canProceed,
  isSkippable,
  isSubmitting = false,
  onFinish,
  isFirstScreen = false,
  isLastScreen = false,
}: OnboardingNavigationProps<T>) => {
  const { emit } = useAnalytics();
  const buttonText = isLastScreen ? "Finish" : "Next";

  return (
    <VStack gap={3} w="full" pt={4}>
      <Button
        colorPalette="orange"
        variant="solid"
        size="lg"
        w="full"
        borderRadius="xl"
        fontWeight="600"
        onClick={() => {
          emit("clicked", isLastScreen ? "finish" : "next", {
            currentScreenIndex,
            canProceed,
          });
          if (isLastScreen) onFinish();
          else onNext();
        }}
        disabled={!canProceed || isSubmitting}
        loading={isSubmitting}
      >
        {buttonText}
      </Button>

      <HStack justify="center" w="full" gap={3}>
        {!isFirstScreen && (
          <Button
            variant="ghost"
            size="sm"
            color="fg.muted"
            fontWeight="normal"
            _hover={{ color: "fg.DEFAULT" }}
            onClick={() => {
              emit("clicked", "previous", { currentScreenIndex });
              onPrev();
            }}
          >
            Back
          </Button>
        )}

        {isSkippable && (
          <Button
            variant="ghost"
            size="sm"
            color="fg.muted"
            fontWeight="normal"
            _hover={{ color: "fg.DEFAULT" }}
            onClick={() => {
              emit("clicked", isLastScreen ? "finish" : "skip", {
                currentScreenIndex,
              });
              if (isLastScreen) onFinish();
              else onSkip();
            }}
            disabled={isSubmitting}
          >
            Skip
            <Icon size="xs">
              <SkipForward />
            </Icon>
          </Button>
        )}
      </HStack>
    </VStack>
  );
};
