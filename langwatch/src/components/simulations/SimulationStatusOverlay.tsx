import { ScenarioRunStatus } from "~/app/api/scenario-events/[[...route]]/enums";
import { Box, VStack, Text } from "@chakra-ui/react";
import { Check, AlertCircle, X } from "react-feather";

// Component for the status overlay when simulation is complete
export function SimulationStatusOverlay({
  status,
}: {
  status: ScenarioRunStatus;
}) {
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
