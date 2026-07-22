import { Box } from "@chakra-ui/react";
import { ScenarioRunStatus } from "@langwatch/contracts/scenarios/enums";
import { SCENARIO_RUN_STATUS_CONFIG } from "./scenario-run-status-config";

const LIGHT_MODE_GRADIENTS = {
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

type LightModeGradient = keyof typeof LIGHT_MODE_GRADIENTS;

const LIGHT_MODE_GRADIENT_BY_STATUS: Record<
  ScenarioRunStatus,
  LightModeGradient
> = {
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

/**
 * Gradient-from token for the status scrim, per status. Failures and
 * stalls read slightly stronger; passes are the expected outcome and
 * stay quiet; cancelled quieter still.
 */
const SCRIM_TOKENS: Record<ScenarioRunStatus, string> = {
  [ScenarioRunStatus.SUCCESS]: "green.solid/20",
  [ScenarioRunStatus.FAILED]: "red.solid/30",
  [ScenarioRunStatus.ERROR]: "red.solid/30",
  [ScenarioRunStatus.CANCELLED]: "gray.solid/15",
  [ScenarioRunStatus.STALLED]: "yellow.solid/30",
  [ScenarioRunStatus.IN_PROGRESS]: "gray.solid/15",
  [ScenarioRunStatus.PENDING]: "gray.solid/15",
  [ScenarioRunStatus.QUEUED]: "gray.solid/15",
  [ScenarioRunStatus.RUNNING]: "gray.solid/15",
};

interface OverlayConfig {
  isComplete: boolean;
  /** Full-card completion wash used by the light theme. */
  lightModeGradient: string;
  /** Color token the bottom scrim fades up from, e.g. "red.solid/30". */
  scrim: string;
}

/** Returns overlay configuration for a given scenario run status. */
export function getOverlayConfig(status: ScenarioRunStatus): OverlayConfig {
  return {
    isComplete: SCENARIO_RUN_STATUS_CONFIG[status].isComplete,
    lightModeGradient:
      LIGHT_MODE_GRADIENTS[LIGHT_MODE_GRADIENT_BY_STATUS[status]],
    scrim: SCRIM_TOKENS[status],
  };
}

/**
 * Status treatment for completed simulation cards. Light mode uses a
 * full-card layered wash, while dark mode keeps the quieter bottom scrim.
 * Running cards get no overlay.
 */
export function SimulationStatusOverlay({
  status,
}: {
  status: ScenarioRunStatus;
}) {
  const { isComplete, lightModeGradient, scrim } = getOverlayConfig(status);

  if (!isComplete) return null;

  return (
    <>
      <Box
        aria-hidden
        data-testid="simulation-status-overlay-light"
        position="absolute"
        inset={0}
        background={lightModeGradient}
        display={{ base: "block", _dark: "none" }}
        zIndex={1}
        pointerEvents="none"
      />
      <Box
        aria-hidden
        data-testid="simulation-status-overlay-dark"
        position="absolute"
        bottom={0}
        left={0}
        right={0}
        height="65%"
        bgGradient="to-t"
        gradientFrom={scrim}
        gradientTo="transparent"
        display={{ base: "none", _dark: "block" }}
        zIndex={1}
        pointerEvents="none"
      />
    </>
  );
}
