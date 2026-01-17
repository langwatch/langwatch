import { Box, Text, VStack } from "@chakra-ui/react";
import { AlertCircle, Check, X } from "react-feather";
import { ScenarioRunStatus } from "~/app/api/scenario-events/[[...route]]/enums";

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

  // Mesh gradient with layered radials - light spot at bottom
  const bgGradient = isPass
    ? `
      radial-gradient(ellipse at 0% 100%, rgba(134, 239, 172, 0.8) 0%, transparent 50%),
      radial-gradient(ellipse at 100% 50%, rgba(72, 187, 120, 0.75) 0%, transparent 45%),
      radial-gradient(ellipse at 70% 0%, rgba(56, 161, 105, 0.8) 0%, transparent 50%),
      linear-gradient(160deg, rgba(56, 161, 105, 0.82) 0%, rgba(104, 211, 145, 0.78) 100%)
    `
    : isCancelled
      ? `
      radial-gradient(ellipse at 0% 100%, rgba(226, 232, 240, 0.8) 0%, transparent 50%),
      radial-gradient(ellipse at 100% 50%, rgba(160, 174, 192, 0.75) 0%, transparent 45%),
      radial-gradient(ellipse at 70% 0%, rgba(113, 128, 150, 0.8) 0%, transparent 50%),
      linear-gradient(160deg, rgba(113, 128, 150, 0.82) 0%, rgba(160, 174, 192, 0.78) 100%)
    `
      : `
      radial-gradient(ellipse at 0% 100%, rgba(254, 178, 178, 0.8) 0%, transparent 50%),
      radial-gradient(ellipse at 100% 50%, rgba(245, 101, 101, 0.75) 0%, transparent 45%),
      radial-gradient(ellipse at 70% 0%, rgba(229, 62, 62, 0.8) 0%, transparent 50%),
      linear-gradient(160deg, rgba(229, 62, 62, 0.82) 0%, rgba(252, 129, 129, 0.78) 100%)
    `;

  const Icon = isPass ? Check : isCancelled ? AlertCircle : X;
  const statusText = isPass ? "Pass" : isCancelled ? "Cancelled" : "Fail";

  return (
    <Box
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      background={bgGradient}
      display="flex"
      alignItems="center"
      justifyContent="center"
      zIndex={20}
      borderRadius="xl"
    >
      <VStack gap={2}>
        <Box bg="whiteAlpha.200" borderRadius="full" boxShadow="xl" p={3}>
          <Icon size={32} color="white" strokeWidth={2.5} />
        </Box>
        <Text
          fontSize="lg"
          fontWeight="bold"
          color="white"
          textShadow="0 2px 4px rgba(0,0,0,0.3)"
        >
          {statusText}
        </Text>
      </VStack>
    </Box>
  );
}
