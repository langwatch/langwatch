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

interface CardStatusConfig {
  isComplete: boolean;
  colorPalette: string;
}

/**
 * Returns visual configuration for a scenario run status in the card header.
 * Uses an exhaustive switch to ensure compile-time errors when new statuses are added.
 */
function getCardStatusConfig(status: ScenarioRunStatus): CardStatusConfig {
  switch (status) {
    case ScenarioRunStatus.SUCCESS:
      return { isComplete: true, colorPalette: "green" };
    case ScenarioRunStatus.FAILED:
    case ScenarioRunStatus.ERROR:
      return { isComplete: true, colorPalette: "red" };
    case ScenarioRunStatus.CANCELLED:
      return { isComplete: true, colorPalette: "gray" };
    case ScenarioRunStatus.STALLED:
      return { isComplete: true, colorPalette: "yellow" };
    case ScenarioRunStatus.IN_PROGRESS:
      return { isComplete: false, colorPalette: "blue" };
    case ScenarioRunStatus.PENDING:
      return { isComplete: false, colorPalette: "gray" };
    default: {
      const _exhaustive: never = status;
      throw new Error(`Unhandled ScenarioRunStatus: ${_exhaustive}`);
    }
  }
}

function SimulationCardHeader({
  title,
  status,
}: {
  title: string;
  status?: ScenarioRunStatus;
}) {
  const { isComplete, colorPalette } = getCardStatusConfig(
    status ?? ScenarioRunStatus.IN_PROGRESS,
  );

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
