import { Card } from "@chakra-ui/react";
import { Badge, Box, HStack, VStack, Text } from "@chakra-ui/react";
import { Maximize, Minimize } from "react-feather";
import { ScenarioRunStatus } from "~/app/api/scenario-events/[[...route]]/schemas";

// Card props: title, status, messages
export interface SimulationCardMessage {
  role: "agent" | "user";
  content: string;
}

export interface SimulationCardProps {
  title: string;
  status: ScenarioRunStatus;
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
  }[status];

  return (
    <Card.Root>
      <Card.Header>
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
          >
            {!isExpanded ? <Maximize size={16} /> : <Minimize size={16} />}
          </Box>
        </HStack>
      </Card.Header>
      <Card.Body>
        <VStack
          align="stretch"
          gap="2"
          overflowY="scroll"
          height={isExpanded ? "auto" : "150px"}
        >
          {children}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
