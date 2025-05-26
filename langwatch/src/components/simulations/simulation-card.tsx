import { Card } from "@chakra-ui/react";
import { Badge, Box, HStack, VStack, Text } from "@chakra-ui/react";
import { Maximize, Minimize } from "react-feather";

// Card props: title, status, messages
export interface SimulationCardMessage {
  role: "agent" | "user";
  content: string;
}

export interface SimulationCardProps {
  title: string;
  status: "completed" | "in-progress" | "failed";
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
    completed: "green",
    "in-progress": "yellow",
    failed: "red",
  }[status];

  return (
    <Card.Root>
      <Card.Header>
        <HStack justify="space-between" align="start">
          <VStack align="start" gap="0">
            <Text fontWeight="bold">{title}</Text>
            <Badge colorPalette={statusColor} size="sm" mt="1">
              {status.charAt(0).toUpperCase() +
                status.slice(1).replace("-", " ")}
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
        <VStack align="stretch" gap="2">
          {children}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
