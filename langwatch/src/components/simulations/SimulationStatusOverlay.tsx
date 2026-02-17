import { Box, Text, VStack } from "@chakra-ui/react";
import type { FC } from "react";
import { AlertCircle, AlertTriangle, Check, X } from "react-feather";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { SCENARIO_RUN_STATUS_CONFIG } from "~/server/scenarios/status-config";
import { useColorModeValue } from "../ui/color-mode";

interface OverlayConfig {
  isComplete: boolean;
  icon: FC<{ size: number; color: string; strokeWidth: number }>;
  statusText: string;
  gradientLight: string;
  gradientDark: string;
}

const GRADIENT_LIGHT = {
  pass: `
    radial-gradient(ellipse at 0% 100%, rgba(134, 239, 172, 0.8) 0%, transparent 50%),
    radial-gradient(ellipse at 100% 50%, rgba(72, 187, 120, 0.75) 0%, transparent 45%),
    radial-gradient(ellipse at 70% 0%, rgba(56, 161, 105, 0.8) 0%, transparent 50%),
    linear-gradient(160deg, rgba(56, 161, 105, 0.82) 0%, rgba(104, 211, 145, 0.78) 100%)
  `,
  cancelled: `
    radial-gradient(ellipse at 0% 100%, rgba(226, 232, 240, 0.8) 0%, transparent 50%),
    radial-gradient(ellipse at 100% 50%, rgba(160, 174, 192, 0.75) 0%, transparent 45%),
    radial-gradient(ellipse at 70% 0%, rgba(113, 128, 150, 0.8) 0%, transparent 50%),
    linear-gradient(160deg, rgba(113, 128, 150, 0.82) 0%, rgba(160, 174, 192, 0.78) 100%)
  `,
  fail: `
    radial-gradient(ellipse at 0% 100%, rgba(254, 178, 178, 0.8) 0%, transparent 50%),
    radial-gradient(ellipse at 100% 50%, rgba(245, 101, 101, 0.75) 0%, transparent 45%),
    radial-gradient(ellipse at 70% 0%, rgba(229, 62, 62, 0.8) 0%, transparent 50%),
    linear-gradient(160deg, rgba(229, 62, 62, 0.82) 0%, rgba(252, 129, 129, 0.78) 100%)
  `,
  stalled: `
    radial-gradient(ellipse at 0% 100%, rgba(251, 211, 141, 0.8) 0%, transparent 50%),
    radial-gradient(ellipse at 100% 50%, rgba(236, 201, 75, 0.75) 0%, transparent 45%),
    radial-gradient(ellipse at 70% 0%, rgba(214, 158, 46, 0.8) 0%, transparent 50%),
    linear-gradient(160deg, rgba(214, 158, 46, 0.82) 0%, rgba(236, 201, 75, 0.78) 100%)
  `,
} as const;

const GRADIENT_DARK = {
  pass: `
    radial-gradient(ellipse at 0% 100%, rgba(74, 222, 128, 0.35) 0%, transparent 50%),
    radial-gradient(ellipse at 100% 50%, rgba(34, 197, 94, 0.3) 0%, transparent 45%),
    radial-gradient(ellipse at 70% 0%, rgba(22, 163, 74, 0.35) 0%, transparent 50%),
    linear-gradient(160deg, rgba(22, 163, 74, 0.5) 0%, rgba(74, 222, 128, 0.45) 100%)
  `,
  cancelled: `
    radial-gradient(ellipse at 0% 100%, rgba(161, 161, 170, 0.35) 0%, transparent 50%),
    radial-gradient(ellipse at 100% 50%, rgba(113, 113, 122, 0.3) 0%, transparent 45%),
    radial-gradient(ellipse at 70% 0%, rgba(82, 82, 91, 0.35) 0%, transparent 50%),
    linear-gradient(160deg, rgba(82, 82, 91, 0.5) 0%, rgba(161, 161, 170, 0.45) 100%)
  `,
  fail: `
    radial-gradient(ellipse at 0% 100%, rgba(248, 113, 113, 0.35) 0%, transparent 50%),
    radial-gradient(ellipse at 100% 50%, rgba(239, 68, 68, 0.3) 0%, transparent 45%),
    radial-gradient(ellipse at 70% 0%, rgba(220, 38, 38, 0.35) 0%, transparent 50%),
    linear-gradient(160deg, rgba(220, 38, 38, 0.5) 0%, rgba(248, 113, 113, 0.45) 100%)
  `,
  stalled: `
    radial-gradient(ellipse at 0% 100%, rgba(251, 191, 36, 0.35) 0%, transparent 50%),
    radial-gradient(ellipse at 100% 50%, rgba(245, 158, 11, 0.3) 0%, transparent 45%),
    radial-gradient(ellipse at 70% 0%, rgba(217, 119, 6, 0.35) 0%, transparent 50%),
    linear-gradient(160deg, rgba(217, 119, 6, 0.5) 0%, rgba(251, 191, 36, 0.45) 100%)
  `,
} as const;

type GradientKey = keyof typeof GRADIENT_LIGHT;

const OVERLAY_ICONS: Record<
  ScenarioRunStatus,
  FC<{ size: number; color: string; strokeWidth: number }>
> = {
  [ScenarioRunStatus.SUCCESS]: Check,
  [ScenarioRunStatus.FAILED]: X,
  [ScenarioRunStatus.ERROR]: X,
  [ScenarioRunStatus.CANCELLED]: AlertCircle,
  [ScenarioRunStatus.STALLED]: AlertTriangle,
  [ScenarioRunStatus.IN_PROGRESS]: Check,
  [ScenarioRunStatus.PENDING]: Check,
};

const OVERLAY_STATUS_TEXT: Record<ScenarioRunStatus, string> = {
  [ScenarioRunStatus.SUCCESS]: "Pass",
  [ScenarioRunStatus.FAILED]: "Fail",
  [ScenarioRunStatus.ERROR]: "Fail",
  [ScenarioRunStatus.CANCELLED]: "Cancelled",
  [ScenarioRunStatus.STALLED]: "Stalled",
  [ScenarioRunStatus.IN_PROGRESS]: "",
  [ScenarioRunStatus.PENDING]: "",
};

const OVERLAY_GRADIENTS: Record<ScenarioRunStatus, GradientKey> = {
  [ScenarioRunStatus.SUCCESS]: "pass",
  [ScenarioRunStatus.FAILED]: "fail",
  [ScenarioRunStatus.ERROR]: "fail",
  [ScenarioRunStatus.CANCELLED]: "cancelled",
  [ScenarioRunStatus.STALLED]: "stalled",
  [ScenarioRunStatus.IN_PROGRESS]: "pass",
  [ScenarioRunStatus.PENDING]: "pass",
};

/**
 * Returns overlay configuration for a given scenario run status.
 * Uses exhaustive Record types to ensure compile-time errors when new statuses are added.
 */
export function getOverlayConfig(status: ScenarioRunStatus): OverlayConfig {
  const gradientKey = OVERLAY_GRADIENTS[status];
  return {
    isComplete: SCENARIO_RUN_STATUS_CONFIG[status].isComplete,
    icon: OVERLAY_ICONS[status],
    statusText: OVERLAY_STATUS_TEXT[status],
    gradientLight: GRADIENT_LIGHT[gradientKey],
    gradientDark: GRADIENT_DARK[gradientKey],
  };
}

export function SimulationStatusOverlay({
  status,
}: {
  status: ScenarioRunStatus;
}) {
  const config = getOverlayConfig(status);
  const bgGradient = useColorModeValue(
    config.gradientLight,
    config.gradientDark,
  );

  if (!config.isComplete) return null;

  const Icon = config.icon;

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
          {config.statusText}
        </Text>
      </VStack>
    </Box>
  );
}
