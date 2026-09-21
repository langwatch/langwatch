/**
 * The full-bleed stage the takeover screens play on: no card, no chrome,
 * the content block centred so it drifts up as the words land. Phases fade
 * through it over 450ms.
 */
import { Box, Flex } from "@chakra-ui/react";
import type React from "react";

import { OnboardingMeshBackground } from "../../../../ui/elements/onboarding-mesh-background.tsx";

export const TAKEOVER_FADE_MS = 450;

export function TakeoverStage({ children }: { children: React.ReactNode }) {
  return (
    <Box
      w="full"
      minH="100dvh"
      bg="bg.page"
      position="relative"
      overflow="hidden"
      data-testid="takeover-stage"
    >
      <OnboardingMeshBackground />
      <Flex position="relative" minH="100dvh" align="center" justify="center" px={6}>
        {children}
      </Flex>
    </Box>
  );
}
