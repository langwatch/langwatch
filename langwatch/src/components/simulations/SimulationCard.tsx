import { Box, Card, Text, VStack } from "@chakra-ui/react";
import type { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { SimulationStatusOverlay } from "./SimulationStatusOverlay";

export interface SimulationCardMessage {
  role: "agent" | "user";
  content: string;
}

export interface SimulationCardProps {
  title: string;
  status?: ScenarioRunStatus;
  children: React.ReactNode;
}

function SimulationCardHeader({
  title,
  hasOverlay,
}: {
  title: string;
  hasOverlay: boolean;
}) {
  return (
    <Box py={3} px={4} w="100%" position="relative" zIndex={25}>
      <Text
        fontSize="sm"
        fontWeight="semibold"
        color={hasOverlay ? "white" : "fg"}
        lineClamp={2}
        textShadow={hasOverlay ? "0 1px 2px rgba(0,0,0,0.3)" : "none"}
      >
        {title}
      </Text>
    </Box>
  );
}

function SimulationCardContent({ children }: { children: React.ReactNode }) {
  return (
    <Card.Body
      p={0}
      height="100%"
      overflow="hidden"
      position="relative"
      w="100%"
    >
      <Box height="100%" width="100%" position="relative">
        {children}
      </Box>
    </Card.Body>
  );
}

export function SimulationCard({
  title,
  status,
  children,
}: SimulationCardProps) {
  return (
    <Card.Root
      height="100%"
      borderWidth={1}
      borderColor="border"
      borderRadius="xl"
      overflow="hidden"
      position="relative"
      boxShadow="lg"
      bg="bg.panel"
      css={{
        animation: "cardFadeIn 0.4s ease-out",
        "@keyframes cardFadeIn": {
          from: { opacity: 0, transform: "translateY(8px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
      }}
    >
      <VStack height="100%" gap={0}>
        <SimulationCardHeader title={title} hasOverlay={!!status} />
        <SimulationCardContent>{children}</SimulationCardContent>
      </VStack>
      {status && <SimulationStatusOverlay status={status} />}
    </Card.Root>
  );
}
