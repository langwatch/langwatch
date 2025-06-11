import { Card } from "@chakra-ui/react";
import { Badge, Box, HStack, VStack, Text } from "@chakra-ui/react";
import { ScenarioRunStatus } from "~/app/api/scenario-events/[[...route]]/enums";
import { SimulationStatusOverlay } from "./SimulationStatusOverlay";

// Card props: title, status, messages
export interface SimulationCardMessage {
  role: "agent" | "user";
  content: string;
}

export interface SimulationCardProps {
  title: string;
  status?: ScenarioRunStatus;
  children: React.ReactNode;
}

// Component for the card header with status and expand button
function SimulationCardHeader({
  title,
  status,
}: {
  title: string;
  status?: ScenarioRunStatus;
}) {
  const colorPallete = {
    [ScenarioRunStatus.SUCCESS]: "green",
    [ScenarioRunStatus.IN_PROGRESS]: "yellow",
    [ScenarioRunStatus.ERROR]: "red",
    [ScenarioRunStatus.CANCELLED]: "gray",
    [ScenarioRunStatus.PENDING]: "gray",
    [ScenarioRunStatus.FAILED]: "red",
  }[status ?? ScenarioRunStatus.IN_PROGRESS];

  const bgColor = `${colorPallete}.100`;

  return (
    <Card.Header
      py={4}
      px={6}
      borderBottom="1px solid"
      borderColor="gray.200"
      w="100%"
      bgColor={bgColor}
    >
      <HStack justify="space-between" align="flex-start" w="100%" gap={6}>
        <Text fontSize="md" fontWeight="bold" color="gray.900">
          {title}
        </Text>
        {status && (
          <HStack align="center" gap={2}>
            <Badge colorPalette={colorPallete} size="sm">
              {status}
            </Badge>
          </HStack>
        )}
      </HStack>
    </Card.Header>
  );
}

// Component for the chat content area
function SimulationCardContent({
  children,
  status,
}: {
  children: React.ReactNode;
  status?: ScenarioRunStatus;
}) {
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

        {/* Top fade overlay */}
        <Box
          position="absolute"
          top={0}
          left={0}
          right={0}
          height="30px"
          background="linear-gradient(to bottom, white, transparent)"
          pointerEvents="none"
          zIndex={10}
        />

        {/* Bottom fade overlay */}
        <Box
          position="absolute"
          bottom={0}
          left={0}
          right={0}
          height="60px"
          background="linear-gradient(to top, white, transparent)"
          pointerEvents="none"
          zIndex={10}
        />
      </Box>
    </Card.Body>
  );
}

// Main simulation card component
export function SimulationCard({
  title,
  status,
  children,
}: SimulationCardProps) {
  return (
    <Card.Root
      height="100%"
      borderWidth={1}
      borderColor="gray.200"
      borderRadius="lg"
      overflow="hidden"
    >
      <VStack height="100%" gap={0}>
        <SimulationCardHeader title={title} status={status} />
        <SimulationCardContent status={status}>
          {children}
          {status && <SimulationStatusOverlay status={status} />}
        </SimulationCardContent>
      </VStack>
    </Card.Root>
  );
}
