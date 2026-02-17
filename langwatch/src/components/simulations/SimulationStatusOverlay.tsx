import { Box, Text, VStack } from "@chakra-ui/react";
import { AlertCircle, Check, X } from "react-feather";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { useColorModeValue } from "../ui/color-mode";

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

  const isPass = status === ScenarioRunStatus.SUCCESS;
  const isCancelled = status === ScenarioRunStatus.CANCELLED;

  // Light mode gradients - original mesh style
  const passGradientLight = `
    radial-gradient(ellipse at 0% 100%, rgba(134, 239, 172, 0.8) 0%, transparent 50%),
    radial-gradient(ellipse at 100% 50%, rgba(72, 187, 120, 0.75) 0%, transparent 45%),
    radial-gradient(ellipse at 70% 0%, rgba(56, 161, 105, 0.8) 0%, transparent 50%),
    linear-gradient(160deg, rgba(56, 161, 105, 0.82) 0%, rgba(104, 211, 145, 0.78) 100%)
  `;
  const cancelledGradientLight = `
    radial-gradient(ellipse at 0% 100%, rgba(226, 232, 240, 0.8) 0%, transparent 50%),
    radial-gradient(ellipse at 100% 50%, rgba(160, 174, 192, 0.75) 0%, transparent 45%),
    radial-gradient(ellipse at 70% 0%, rgba(113, 128, 150, 0.8) 0%, transparent 50%),
    linear-gradient(160deg, rgba(113, 128, 150, 0.82) 0%, rgba(160, 174, 192, 0.78) 100%)
  `;
  const failGradientLight = `
    radial-gradient(ellipse at 0% 100%, rgba(254, 178, 178, 0.8) 0%, transparent 50%),
    radial-gradient(ellipse at 100% 50%, rgba(245, 101, 101, 0.75) 0%, transparent 45%),
    radial-gradient(ellipse at 70% 0%, rgba(229, 62, 62, 0.8) 0%, transparent 50%),
    linear-gradient(160deg, rgba(229, 62, 62, 0.82) 0%, rgba(252, 129, 129, 0.78) 100%)
  `;

  // Dark mode gradients - softer, less intense for dark backgrounds
  const passGradientDark = `
    radial-gradient(ellipse at 0% 100%, rgba(74, 222, 128, 0.35) 0%, transparent 50%),
    radial-gradient(ellipse at 100% 50%, rgba(34, 197, 94, 0.3) 0%, transparent 45%),
    radial-gradient(ellipse at 70% 0%, rgba(22, 163, 74, 0.35) 0%, transparent 50%),
    linear-gradient(160deg, rgba(22, 163, 74, 0.5) 0%, rgba(74, 222, 128, 0.45) 100%)
  `;
  const cancelledGradientDark = `
    radial-gradient(ellipse at 0% 100%, rgba(161, 161, 170, 0.35) 0%, transparent 50%),
    radial-gradient(ellipse at 100% 50%, rgba(113, 113, 122, 0.3) 0%, transparent 45%),
    radial-gradient(ellipse at 70% 0%, rgba(82, 82, 91, 0.35) 0%, transparent 50%),
    linear-gradient(160deg, rgba(82, 82, 91, 0.5) 0%, rgba(161, 161, 170, 0.45) 100%)
  `;
  const failGradientDark = `
    radial-gradient(ellipse at 0% 100%, rgba(248, 113, 113, 0.35) 0%, transparent 50%),
    radial-gradient(ellipse at 100% 50%, rgba(239, 68, 68, 0.3) 0%, transparent 45%),
    radial-gradient(ellipse at 70% 0%, rgba(220, 38, 38, 0.35) 0%, transparent 50%),
    linear-gradient(160deg, rgba(220, 38, 38, 0.5) 0%, rgba(248, 113, 113, 0.45) 100%)
  `;

  const passGradient = useColorModeValue(passGradientLight, passGradientDark);
  const cancelledGradient = useColorModeValue(
    cancelledGradientLight,
    cancelledGradientDark,
  );
  const failGradient = useColorModeValue(failGradientLight, failGradientDark);

  const bgGradient = isPass
    ? passGradient
    : isCancelled
      ? cancelledGradient
      : failGradient;

  const Icon = isPass ? Check : isCancelled ? AlertCircle : X;
  const statusText = isPass ? "Pass" : isCancelled ? "Cancelled" : "Fail";

  if (!isComplete) return null;

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
      <VStack gap={3}>
        <Box
          bg="blackAlpha.200"
          borderRadius="full"
          boxShadow="lg"
          p={3}
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          <Icon size={32} color="white" strokeWidth={2.5} />
        </Box>
        <Text fontSize="md" fontWeight="semibold" color="white">
          {statusText}
        </Text>
      </VStack>
    </Box>
  );
}
