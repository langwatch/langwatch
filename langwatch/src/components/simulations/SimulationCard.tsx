import { Card } from "@chakra-ui/react";
import { Badge, Box, HStack, VStack, Text } from "@chakra-ui/react";
import { Maximize, Minimize } from "react-feather";
import { ScenarioRunStatus } from "~/app/api/scenario-events/[[...route]]/enums";

// Card props: title, status, messages
export interface SimulationCardMessage {
  role: "agent" | "user";
  content: string;
}

export interface SimulationCardProps {
  title: string;
  status?: ScenarioRunStatus;
  children: React.ReactNode;
  onExpandToggle: () => void;
  isExpanded: boolean;
}

export function SimulationCard({
  title,
  status,
  children,
  onExpandToggle,
  isExpanded,
}: SimulationCardProps) {
  // Status badge color
  const statusColor = {
    [ScenarioRunStatus.SUCCESS]: "green",
    [ScenarioRunStatus.IN_PROGRESS]: "yellow",
    [ScenarioRunStatus.ERROR]: "red",
    [ScenarioRunStatus.CANCELLED]: "gray",
    [ScenarioRunStatus.PENDING]: "gray",
    [ScenarioRunStatus.FAILED]: "red",
  }[status ?? ScenarioRunStatus.IN_PROGRESS];

  return (
    <Card.Root height="100%">
      <VStack height="100%">
        <Card.Header flex={0}>
          <HStack justify="space-between" align="start">
            <VStack align="start" gap="0">
              <Text fontWeight="bold">{title}</Text>
              <Badge colorPalette={statusColor} size="sm" mt="1">
                {status}
              </Badge>
            </VStack>
            <Box
              as="button"
              aria-label="Expand"
              opacity={0.7}
              _hover={{ opacity: 1 }}
              onClick={onExpandToggle}
              cursor={!!onExpandToggle ? "pointer" : "auto"}
            >
              {!isExpanded ? <Maximize size={16} /> : <Minimize size={16} />}
            </Box>
          </HStack>
        </Card.Header>
        <Card.Body position="relative" height="100%" width="100%">
          <VStack position="absolute" top={0} left={0} right={0} bottom={0}>
            {children}
          </VStack>
        </Card.Body>
      </VStack>
    </Card.Root>
  );
}
