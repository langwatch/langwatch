import { Card } from "@chakra-ui/react";
import { Badge, Box, HStack, VStack, Text } from "@chakra-ui/react";
import { Check, X, AlertCircle } from "react-feather";
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

// Component for the status overlay when simulation is complete
function SimulationStatusOverlay({ status }: { status: ScenarioRunStatus }) {
  const isComplete =
    status === ScenarioRunStatus.SUCCESS ||
    status === ScenarioRunStatus.FAILED ||
    status === ScenarioRunStatus.ERROR ||
    status === ScenarioRunStatus.CANCELLED;

  if (!isComplete) return null;

  const isPass = status === ScenarioRunStatus.SUCCESS;
  const isCancelled = status === ScenarioRunStatus.CANCELLED;

  // Determine background color based on status
  const bgColor = isPass
    ? "rgba(72, 187, 120, 0.9)" // Green for success
    : isCancelled
    ? "rgba(113, 128, 150, 0.9)" // Gray for cancelled
    : "rgba(245, 101, 101, 0.9)"; // Red for failed/error

  // Determine icon and text based on status
  const Icon = isPass ? Check : isCancelled ? AlertCircle : X;
  const statusText = isPass ? "Pass" : isCancelled ? "Cancelled" : "Fail";

  return (
    <Box
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      bg={bgColor}
      display="flex"
      alignItems="center"
      justifyContent="center"
      zIndex={20}
    >
      <VStack gap={3}>
        <Icon size={48} color="white" />
        <Text fontSize="2xl" fontWeight="bold" color="white">
          {statusText}
        </Text>
      </VStack>
    </Box>
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

        {/* Status overlay for completed simulations */}
        {status && <SimulationStatusOverlay status={status} />}
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
        <SimulationCardHeader title={title} status={status} />
        <SimulationCardContent status={status}>
          {children}
        </SimulationCardContent>
      </VStack>
    </Card.Root>
  );
}
