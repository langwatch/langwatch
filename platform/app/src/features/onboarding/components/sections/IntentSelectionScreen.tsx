import { Box, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import type { OrganizationIntent } from "@prisma/client";
import { ChartNoAxesColumn, Telescope } from "lucide-react";
import type React from "react";
import { useAnalytics } from "react-contextual-analytics";
import { useOnboardingFormContext } from "../../contexts/form-context";

interface IntentOption {
  value: OrganizationIntent;
  title: string;
  description: string;
  icon: typeof Telescope;
}

/**
 * Card copy is load-bearing (ADR-038 S1): someone BUILDING a coding agent
 * as their product wants LLMOps, so the governance card speaks of the
 * tools your team uses, and the LLMOps card explicitly claims coding
 * agents you are building. Pinned by test.
 */
const intentOptions: IntentOption[] = [
  {
    value: "LLM_OPS",
    title: "Monitor & evaluate my LLM app",
    description:
      "Trace, evaluate, and improve the LLM apps and agents you're building",
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

export const IntentSelectionScreen: React.FC = () => {
  const { intent, setIntent } = useOnboardingFormContext();
  const { emit } = useAnalytics();

  return (
    <VStack
      gap={3}
      align="stretch"
      w="full"
      minW="0"
      role="radiogroup"
      aria-label="What do you want to do?"
    >
      {intentOptions.map((opt) => {
        const isSelected = intent === opt.value;
        return (
          <Box
            as="button"
            key={opt.value}
            role="radio"
            aria-checked={isSelected}
            w="full"
            textAlign="left"
            borderRadius="2xl"
            border="2px solid"
            borderColor={isSelected ? "orange.400" : "border.muted"}
            bg={isSelected ? "orange.50" : "bg.panel"}
            px={5}
            py={4}
            cursor="pointer"
            transition="all 0.2s ease"
            _hover={{ borderColor: "orange.300" }}
            onClick={() => {
              setIntent(opt.value);
              emit("selected", "intent", { value: opt.value });
            }}
          >
            <HStack gap={4} align="center">
              <Box
                flexShrink={0}
                p={3}
                borderRadius="xl"
                bg="orange.50"
                border="1px solid"
                borderColor="orange.100"
              >
                <Icon color="orange.500" boxSize={6}>
                  <opt.icon strokeWidth={1.5} />
                </Icon>
              </Box>
              <VStack gap={0.5} align="start" flex={1}>
                <Text
                  fontSize="md"
                  fontWeight="semibold"
                  color="fg"
                  letterSpacing="-0.01em"
                >
                  {opt.title}
                </Text>
                <Text fontSize="sm" color="fg.muted" lineHeight="tall">
                  {opt.description}
                </Text>
              </VStack>
            </HStack>
          </Box>
        );
      })}
    </VStack>
  );
};
