import { Box } from "@chakra-ui/react";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { SCENARIO_RUN_STATUS_CONFIG } from "./scenario-run-status-config";
import { useColorModeValue } from "../ui/color-mode";

const GRADIENT_LIGHT = {
  pass: `
    radial-gradient(ellipse at 0% 100%, rgba(134, 239, 172, 0.55) 0%, transparent 50%),
    radial-gradient(ellipse at 100% 50%, rgba(72, 187, 120, 0.5) 0%, transparent 45%),
    radial-gradient(ellipse at 70% 0%, rgba(56, 161, 105, 0.55) 0%, transparent 50%),
    linear-gradient(160deg, rgba(56, 161, 105, 0.58) 0%, rgba(104, 211, 145, 0.52) 100%)
  `,
  cancelled: `
    radial-gradient(ellipse at 0% 100%, rgba(226, 232, 240, 0.55) 0%, transparent 50%),
    radial-gradient(ellipse at 100% 50%, rgba(160, 174, 192, 0.5) 0%, transparent 45%),
    radial-gradient(ellipse at 70% 0%, rgba(113, 128, 150, 0.55) 0%, transparent 50%),
    linear-gradient(160deg, rgba(113, 128, 150, 0.58) 0%, rgba(160, 174, 192, 0.52) 100%)
  `,
  fail: `
    radial-gradient(ellipse at 0% 100%, rgba(254, 178, 178, 0.55) 0%, transparent 50%),
    radial-gradient(ellipse at 100% 50%, rgba(245, 101, 101, 0.5) 0%, transparent 45%),
    radial-gradient(ellipse at 70% 0%, rgba(229, 62, 62, 0.55) 0%, transparent 50%),
    linear-gradient(160deg, rgba(229, 62, 62, 0.58) 0%, rgba(252, 129, 129, 0.52) 100%)
  `,
  stalled: `
    radial-gradient(ellipse at 0% 100%, rgba(251, 211, 141, 0.55) 0%, transparent 50%),
    radial-gradient(ellipse at 100% 50%, rgba(236, 201, 75, 0.5) 0%, transparent 45%),
    radial-gradient(ellipse at 70% 0%, rgba(214, 158, 46, 0.55) 0%, transparent 50%),
    linear-gradient(160deg, rgba(214, 158, 46, 0.58) 0%, rgba(236, 201, 75, 0.52) 100%)
  `,
} as const;

const GRADIENT_DARK = {
  pass: `
    radial-gradient(ellipse at 0% 100%, rgba(74, 222, 128, 0.55) 0%, transparent 55%),
    radial-gradient(ellipse at 100% 50%, rgba(34, 197, 94, 0.42) 0%, transparent 50%),
    linear-gradient(160deg, rgba(22, 163, 74, 0.48) 0%, rgba(74, 222, 128, 0.32) 100%)
  `,
  cancelled: `
    radial-gradient(ellipse at 0% 100%, rgba(161, 161, 170, 0.4) 0%, transparent 55%),
    radial-gradient(ellipse at 100% 50%, rgba(113, 113, 122, 0.3) 0%, transparent 50%),
    linear-gradient(160deg, rgba(82, 82, 91, 0.38) 0%, rgba(161, 161, 170, 0.28) 100%)
  `,
  fail: `
    radial-gradient(ellipse at 0% 100%, rgba(248, 113, 113, 0.55) 0%, transparent 55%),
    radial-gradient(ellipse at 100% 50%, rgba(239, 68, 68, 0.42) 0%, transparent 50%),
    linear-gradient(160deg, rgba(220, 38, 38, 0.48) 0%, rgba(248, 113, 113, 0.32) 100%)
  `,
  stalled: `
    radial-gradient(ellipse at 0% 100%, rgba(251, 191, 36, 0.55) 0%, transparent 55%),
    radial-gradient(ellipse at 100% 50%, rgba(245, 158, 11, 0.42) 0%, transparent 50%),
    linear-gradient(160deg, rgba(217, 119, 6, 0.48) 0%, rgba(251, 191, 36, 0.32) 100%)
  `,
} as const;

type GradientKey = keyof typeof GRADIENT_LIGHT;

const OVERLAY_GRADIENTS: Record<ScenarioRunStatus, GradientKey> = {
  [ScenarioRunStatus.SUCCESS]: "pass",
  [ScenarioRunStatus.FAILED]: "fail",
  [ScenarioRunStatus.ERROR]: "fail",
  [ScenarioRunStatus.CANCELLED]: "cancelled",
  [ScenarioRunStatus.STALLED]: "stalled",
  [ScenarioRunStatus.IN_PROGRESS]: "cancelled",
  [ScenarioRunStatus.PENDING]: "cancelled",
  [ScenarioRunStatus.QUEUED]: "cancelled",
  [ScenarioRunStatus.RUNNING]: "cancelled",
};

interface OverlayConfig {
  isComplete: boolean;
  gradientLight: string;
  gradientDark: string;
}

/** Returns overlay configuration for a given scenario run status. */
export function getOverlayConfig(status: ScenarioRunStatus): OverlayConfig {
  const gradientKey = OVERLAY_GRADIENTS[status];
  return {
    isComplete: SCENARIO_RUN_STATUS_CONFIG[status].isComplete,
    gradientLight: GRADIENT_LIGHT[gradientKey],
    gradientDark: GRADIENT_DARK[gradientKey],
  };
}

/**
 * Subtle background tint overlay for completed simulation cards.
 * Only rendered for terminal states — running cards have no overlay.
 */
export function SimulationStatusOverlay({
  status,
}: {
  status: ScenarioRunStatus;
}) {
  const isComplete = SCENARIO_RUN_STATUS_CONFIG[status].isComplete;
  const gradientKey = OVERLAY_GRADIENTS[status];
  const bgGradient = useColorModeValue(
    GRADIENT_LIGHT[gradientKey],
    GRADIENT_DARK[gradientKey],
  );

  if (!isComplete) return null;

  return (
    <Box
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      background={bgGradient}
      zIndex={1}
      pointerEvents="none"
    />
  );
}
