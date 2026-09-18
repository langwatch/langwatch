import { Button, HStack, VStack } from "@chakra-ui/react";
import { useUiAnalytics } from "@langwatch/browser-host/analytics";

interface OnboardingNavigationProps<T extends number = number> {
  /** The surface these clicks happened on, named by whoever mounted the flow. */
  boundary: string;
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
  boundary,
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
  const analytics = useUiAnalytics();
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
          analytics.track({
            boundary,
            action: "clicked",
            name: isLastScreen ? "finish" : "next",
            attributes: { currentScreenIndex, canProceed },
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
            _hover={{ color: "fg", bg: "bg.muted" }}
            onClick={() => {
              analytics.track({
                boundary,
                action: "clicked",
                name: "previous",
                attributes: { currentScreenIndex },
              });
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
            _hover={{ color: "fg", bg: "bg.muted" }}
            onClick={() => {
              analytics.track({
                boundary,
                action: "clicked",
                name: isLastScreen ? "finish" : "skip",
                attributes: { currentScreenIndex },
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
