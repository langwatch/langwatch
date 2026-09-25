import { Box, HStack, Icon, RadioCard, Text, VStack } from "@chakra-ui/react";
import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import {
  accentChipBg,
  accentChipBorder,
  selectedSurfaceBg,
  selectedSurfaceBorder,
} from "@langwatch/onboarding-browser-kit";
import type { OrganizationIntent } from "@langwatch/organization-contract";
import { ChartNoAxesColumn, Telescope } from "lucide-react";
import type React from "react";

import type { OnboardingScreenProps } from "../../behavior/types.ts";
import { useOnboardingFormContext } from "./form-context.tsx";

interface IntentOption {
  value: OrganizationIntent;
  title: string;
  description: string;
  icon: typeof Telescope;
}

/**
 * Card copy is load-bearing (ADR-038 S1): someone BUILDING a coding agent
 * as their product wants LLMOps, so governance speaks of tools your team
 * uses, and LLMOps explicitly claims coding agents you're building. Pinned by test.
 */
const intentOptions: IntentOption[] = [
  {
    value: "LLM_OPS",
    title: "Monitor & evaluate my LLM app",
    description: "Trace, evaluate, and improve the LLM apps and agents you're building",
    icon: Telescope,
  },
  {
    value: "AGENT_GOVERNANCE",
    title: "Track AI coding agents",
    description:
      "Usage, spend, and sessions for the AI coding tools your team uses, like Claude Code, Codex, and Cursor",
    icon: ChartNoAxesColumn,
  },
];

export const IntentSelectionScreen: React.FC<OnboardingScreenProps> = ({ surface }) => {
  const { intent, setIntent } = useOnboardingFormContext();
  const analytics = useUiAnalytics();

  return (
    <RadioCard.Root
      unstyled
      value={intent ?? null}
      onValueChange={(details) => {
        const chosen = intentOptions.find((opt) => opt.value === details.value);
        if (!chosen) return;
        setIntent(chosen.value);
        analytics.track({
          boundary: surface.boundary,
          action: "selected",
          name: "intent",
          attributes: { ...surface.attributes, value: chosen.value },
        });
      }}
      display="flex"
      flexDirection="column"
      gap={3}
      alignItems="stretch"
      w="full"
      minW="0"
      aria-label="What do you want to do?"
    >
      {intentOptions.map((opt) => {
        const isSelected = intent === opt.value;
        return (
          <RadioCard.Item
            key={opt.value}
            value={opt.value}
            unstyled
            display="block"
            w="full"
            textAlign="left"
            borderRadius="2xl"
            border="2px solid"
            borderColor={isSelected ? selectedSurfaceBorder : "border.muted"}
            bg={isSelected ? selectedSurfaceBg : "bg.panel"}
            px={5}
            py={4}
            cursor="pointer"
            transition="all 0.2s ease"
            _hover={{ borderColor: "orange.300" }}
            focusVisibleRing="outside"
          >
            <RadioCard.ItemHiddenInput />
            <HStack gap={4} align="center">
              <Box
                data-testid="intent-icon-chip"
                flexShrink={0}
                p={3}
                borderRadius="xl"
                bg={accentChipBg}
                border="1px solid"
                borderColor={accentChipBorder}
              >
                <Icon color="orange.500" boxSize={6}>
                  <opt.icon strokeWidth={1.5} />
                </Icon>
              </Box>
              <VStack gap={0.5} align="start" flex={1}>
                <Text fontSize="md" fontWeight="semibold" color="fg" letterSpacing="-0.01em">
                  {opt.title}
                </Text>
                <Text fontSize="sm" color="fg.muted" lineHeight="tall">
                  {opt.description}
                </Text>
              </VStack>
            </HStack>
          </RadioCard.Item>
        );
      })}
    </RadioCard.Root>
  );
};
