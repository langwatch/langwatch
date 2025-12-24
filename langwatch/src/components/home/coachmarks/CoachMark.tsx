import {
  Box,
  Button,
  HStack,
  Text,
  VStack,
  Portal,
} from "@chakra-ui/react";
import { LuX } from "react-icons/lu";
import { Logo3D } from "./Logo3D";
import type { TourStep } from "./types";

interface CoachMarkProps {
  step: TourStep;
  currentStepNumber: number;
  totalSteps: number;
  isLastStep: boolean;
  onNext: () => void;
  onSkip: () => void;
  position: {
    top: number;
    left: number;
  };
}

export function CoachMark({
  step,
  currentStepNumber,
  totalSteps,
  isLastStep,
  onNext,
  onSkip,
  position,
}: CoachMarkProps) {
  return (
    <Portal>
      <Box
        position="fixed"
        top={`${position.top}px`}
        left={`${position.left}px`}
        zIndex={1402}
        width="320px"
        padding={6}
        background="white"
        border="1px solid"
        borderColor="gray.300"
        boxShadow="0px 4px 12px rgba(0, 0, 0, 0.08)"
      >
        <VStack align="stretch" gap={3}>
          {/* Header with Logo and Close */}
          <HStack justify="space-between" align="start">
            <Logo3D />
            <Box
              as="button"
              onClick={onSkip}
              cursor="pointer"
              color="gray.500"
              _hover={{ color: "gray.700" }}
              aria-label="Close tour"
            >
              <LuX size={18} />
            </Box>
          </HStack>

          {/* Title */}
          <Text fontSize="lg" fontWeight="semibold" color="gray.900">
            {step.title}
          </Text>

          {/* Description */}
          <Text fontSize="sm" color="gray.600" lineHeight="1.6">
            {step.description}
          </Text>

          {/* Footer with Buttons */}
          <HStack justify="space-between" marginTop={2}>
            <Button variant="outline" size="sm" onClick={onSkip}>
              Skip
            </Button>

            <Text fontSize="xs" color="gray.500" fontWeight="medium">
              {currentStepNumber + 1}/{totalSteps}
            </Text>

            <Button colorPalette="blue" size="sm" onClick={onNext}>
              {isLastStep ? "Start" : "Next"}
            </Button>
          </HStack>
        </VStack>
      </Box>
    </Portal>
  );
}
