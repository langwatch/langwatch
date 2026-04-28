import { Box, VStack } from "@chakra-ui/react";
import { OnboardingMeshBackground } from "~/features/onboarding/components/OnboardingMeshBackground";
import { TracesEmptyOnboarding } from "./TracesEmptyOnboarding";

export const EmptyState = () => {
  return (
    <Box position="relative" width="full" height="full">
      <OnboardingMeshBackground />
      <VStack
        position="relative"
        zIndex={1}
        flex={1}
        width="full"
        height="full"
        align="stretch"
        gap={0}
        overflowY="auto"
      >
        <TracesEmptyOnboarding />
      </VStack>
    </Box>
  );
};
