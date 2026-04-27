import { Button, HStack, VStack } from "@chakra-ui/react";
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
    <VStack gap={3} w="full" pt={2}>
      <Button
        colorPalette="orange"
        variant="solid"
        size="lg"
        w="full"
        borderRadius="10px"
        fontWeight="600"
        h="44px"
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

      <HStack justify="center" w="full" gap={1}>
        {!isFirstScreen && (
          <Button
            variant="ghost"
            size="sm"
            color="fg.subtle"
            fontWeight="semibold"
            fontSize="14px"
            borderRadius="8px"
            disabled={isSubmitting}
            _hover={{ color: "fg.DEFAULT", bg: "bg.muted" }}
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
            color="fg.subtle"
            fontWeight="semibold"
            fontSize="14px"
            borderRadius="8px"
            _hover={{ color: "fg.DEFAULT", bg: "bg.muted" }}
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
          </Button>
        )}
      </HStack>
    </VStack>
  );
};
