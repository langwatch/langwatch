import { Card } from "@chakra-ui/react";
import { Badge, Box, HStack, VStack, Text } from "@chakra-ui/react";
import { ExpandIcon } from "lucide-react";
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
  onExpandToggle?: () => void;
  isExpanded?: boolean;
  runAt: Date;
}

// Component for the card header with status and expand button
function SimulationCardHeader({
  title,
  status,
  isExpanded,
  onExpandToggle,
  runAt,
}: {
  title: string;
  status?: ScenarioRunStatus;
  isExpanded?: boolean;
  onExpandToggle?: () => void;
  runAt: Date;
}) {
  const statusColor = {
    [ScenarioRunStatus.SUCCESS]: "green",
    [ScenarioRunStatus.IN_PROGRESS]: "yellow",
    [ScenarioRunStatus.ERROR]: "red",
    [ScenarioRunStatus.CANCELLED]: "gray",
    [ScenarioRunStatus.PENDING]: "gray",
    [ScenarioRunStatus.FAILED]: "red",
  }[status ?? ScenarioRunStatus.IN_PROGRESS];

  return (
    <Card.Header
      py={4}
      px={6}
      borderBottom="1px solid"
      borderColor="gray.200"
      w="100%"
    >
      <HStack justify="space-between" align="flex-start" w="100%" gap={6}>
        <VStack align="start" gap={1} flex={1}>
          <Text fontSize="lg" fontWeight="bold" color="gray.900">
            {title}
          </Text>
          {status && (
            <HStack align="center" gap={2}>
              <Text fontSize="sm" color="gray.600">
                Run: {runAt.toLocaleString()}
              </Text>
              <Badge colorPalette={statusColor} size="sm">
                {status}
              </Badge>
            </HStack>
          )}
        </VStack>
        {onExpandToggle && (
          <Box
            as="button"
            aria-label={isExpanded ? "Minimize" : "Expand"}
            borderRadius="md"
            opacity={0.7}
            _hover={{
              opacity: 1,
            }}
            onClick={onExpandToggle}
            cursor="pointer"
            transition="all 0.2s"
          >
            <ExpandIcon size={16} />
          </Box>
        )}
      </HStack>
    </Card.Header>
  );
}

// Component for the chat content area
function SimulationCardContent({ children }: { children: React.ReactNode }) {
  return (
    <Card.Body p={0} height="100%" overflow="hidden" position="relative">
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
  onExpandToggle,
  isExpanded,
  runAt,
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
        <SimulationCardHeader
          title={title}
          status={status}
          runAt={runAt}
          isExpanded={isExpanded}
          onExpandToggle={onExpandToggle}
        />
        <SimulationCardContent>{children}</SimulationCardContent>
      </VStack>
    </Card.Root>
  );
}
