import { HStack, Icon, VStack } from "@chakra-ui/react";
import { Sparkles } from "lucide-react";
import type React from "react";

/**
 * Purple/pink gradient callout used to surface the AI sparkles affordance
 * across multiple onboarding steps (FilteringStep, WhatAreLensesStep).
 * The body markup differs per step — pass it as children.
 */
export const AiCallout: React.FC<{
  bodyGap?: number;
  children: React.ReactNode;
}> = ({ bodyGap = 1, children }) => (
  <HStack
    gap={3}
    align="flex-start"
    borderRadius="md"
    paddingX={4}
    paddingY={3}
    borderWidth="1px"
    borderColor="purple.muted"
    backgroundImage="linear-gradient(135deg, var(--chakra-colors-purple-subtle) 0%, var(--chakra-colors-pink-subtle) 100%)"
  >
    <Icon boxSize={4} color="purple.fg" marginTop={0.5}>
      <Sparkles />
    </Icon>
    <VStack align="stretch" gap={bodyGap}>
      {children}
    </VStack>
  </HStack>
);
