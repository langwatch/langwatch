import { Badge, Box, Card, HStack, Text, VStack } from "@chakra-ui/react";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
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
  status,
}: {
  title: string;
  status?: ScenarioRunStatus;
}) {
  const isComplete =
    status === ScenarioRunStatus.SUCCESS ||
    status === ScenarioRunStatus.FAILED ||
    status === ScenarioRunStatus.ERROR ||
    status === ScenarioRunStatus.CANCELLED;

  const colorPalette = {
    [ScenarioRunStatus.SUCCESS]: "green",
    [ScenarioRunStatus.IN_PROGRESS]: "blue",
    [ScenarioRunStatus.ERROR]: "red",
    [ScenarioRunStatus.CANCELLED]: "gray",
    [ScenarioRunStatus.PENDING]: "gray",
    [ScenarioRunStatus.FAILED]: "red",
  }[status ?? ScenarioRunStatus.IN_PROGRESS];

  return (
    <Box py={3} px={4} w="100%" position="relative" zIndex={25}>
      <HStack justify="space-between" align="center" w="100%" gap={4}>
        <Text
          fontSize="sm"
          fontWeight="semibold"
          color={isComplete ? "white" : "fg"}
          lineClamp={2}
          textShadow={isComplete ? "0 1px 2px rgba(0,0,0,0.3)" : "none"}
        >
          {title}
        </Text>
        {status && (
          <Badge
            colorPalette={colorPalette}
            size="sm"
            variant={isComplete ? "solid" : "subtle"}
          >
            {status}
          </Badge>
        )}
      </HStack>
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
    >
      <VStack height="100%" gap={0}>
        <SimulationCardHeader title={title} status={status} />
        <SimulationCardContent>{children}</SimulationCardContent>
      </VStack>
      {status && <SimulationStatusOverlay status={status} />}
    </Card.Root>
  );
}
