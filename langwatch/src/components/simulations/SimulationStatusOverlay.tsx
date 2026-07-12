import { Box } from "@chakra-ui/react";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { SCENARIO_RUN_STATUS_CONFIG } from "./scenario-run-status-config";

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
  /** Color token the bottom scrim fades up from, e.g. "red.solid/30". */
  scrim: string;
}

/** Returns overlay configuration for a given scenario run status. */
export function getOverlayConfig(status: ScenarioRunStatus): OverlayConfig {
  return {
    isComplete: SCENARIO_RUN_STATUS_CONFIG[status].isComplete,
    scrim: SCRIM_TOKENS[status],
  };
}

/**
 * Status scrim for completed simulation cards: a soft gradient in the
 * status hue rising from the bottom edge, anchoring the status pill while
 * the conversation preview above stays legible. Running cards get none.
 */
export function SimulationStatusOverlay({
  status,
}: {
  status: ScenarioRunStatus;
}) {
  const { isComplete, scrim } = getOverlayConfig(status);

  if (!isComplete) return null;

  return (
    <Box
      position="absolute"
      bottom={0}
      left={0}
      right={0}
      height="65%"
      bgGradient="to-t"
      gradientFrom={scrim}
      gradientTo="transparent"
      zIndex={1}
      pointerEvents="none"
    />
  );
}
