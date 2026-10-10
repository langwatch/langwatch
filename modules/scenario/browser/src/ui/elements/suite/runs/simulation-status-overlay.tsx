import { Box } from "@langwatch/design-system/primitives";
import { SimulationRunStatus as ScenarioRunStatus } from "@langwatch/scenario-contract";

import { SCENARIO_RUN_STATUS_CONFIG } from "../../../../model/scenario-run-status-config.ts";

const LIGHT_MODE_GRADIENTS = {
  pass: `
    radial-gradient(ellipse at 0% 100%, color-mix(in srgb, var(--chakra-colors-green-subtle) 55%, transparent) 0%, transparent 50%),
    radial-gradient(ellipse at 100% 50%, color-mix(in srgb, var(--chakra-colors-green-subtle) 50%, transparent) 0%, transparent 45%),
    radial-gradient(ellipse at 70% 0%, color-mix(in srgb, var(--chakra-colors-green-subtle) 55%, transparent) 0%, transparent 50%),
    linear-gradient(160deg, color-mix(in srgb, var(--chakra-colors-green-subtle) 58%, transparent) 0%, color-mix(in srgb, var(--chakra-colors-green-subtle) 52%, transparent) 100%)
  `,
  cancelled: `
    radial-gradient(ellipse at 0% 100%, color-mix(in srgb, var(--chakra-colors-gray-subtle) 55%, transparent) 0%, transparent 50%),
    radial-gradient(ellipse at 100% 50%, color-mix(in srgb, var(--chakra-colors-gray-subtle) 50%, transparent) 0%, transparent 45%),
    radial-gradient(ellipse at 70% 0%, color-mix(in srgb, var(--chakra-colors-gray-subtle) 55%, transparent) 0%, transparent 50%),
    linear-gradient(160deg, color-mix(in srgb, var(--chakra-colors-gray-subtle) 58%, transparent) 0%, color-mix(in srgb, var(--chakra-colors-gray-subtle) 52%, transparent) 100%)
  `,
  fail: `
    radial-gradient(ellipse at 0% 100%, color-mix(in srgb, var(--chakra-colors-red-subtle) 55%, transparent) 0%, transparent 50%),
    radial-gradient(ellipse at 100% 50%, color-mix(in srgb, var(--chakra-colors-red-subtle) 50%, transparent) 0%, transparent 45%),
    radial-gradient(ellipse at 70% 0%, color-mix(in srgb, var(--chakra-colors-red-subtle) 55%, transparent) 0%, transparent 50%),
    linear-gradient(160deg, color-mix(in srgb, var(--chakra-colors-red-subtle) 58%, transparent) 0%, color-mix(in srgb, var(--chakra-colors-red-subtle) 52%, transparent) 100%)
  `,
  stalled: `
    radial-gradient(ellipse at 0% 100%, color-mix(in srgb, var(--chakra-colors-yellow-subtle) 55%, transparent) 0%, transparent 50%),
    radial-gradient(ellipse at 100% 50%, color-mix(in srgb, var(--chakra-colors-yellow-subtle) 50%, transparent) 0%, transparent 45%),
    radial-gradient(ellipse at 70% 0%, color-mix(in srgb, var(--chakra-colors-yellow-subtle) 55%, transparent) 0%, transparent 50%),
    linear-gradient(160deg, color-mix(in srgb, var(--chakra-colors-yellow-subtle) 58%, transparent) 0%, color-mix(in srgb, var(--chakra-colors-yellow-subtle) 52%, transparent) 100%)
  `,
} as const;

type LightModeGradient = keyof typeof LIGHT_MODE_GRADIENTS;

const LIGHT_MODE_GRADIENT_BY_STATUS: Record<ScenarioRunStatus, LightModeGradient> = {
  [ScenarioRunStatus.SUCCESS]: "pass",
  [ScenarioRunStatus.FAILED]: "fail",
  [ScenarioRunStatus.ERROR]: "fail",
  [ScenarioRunStatus.CANCELLED]: "cancelled",
  [ScenarioRunStatus.STALLED]: "stalled",
  [ScenarioRunStatus.IN_PROGRESS]: "cancelled",
  [ScenarioRunStatus.PENDING]: "cancelled",
  [ScenarioRunStatus.QUEUED]: "cancelled",
  [ScenarioRunStatus.RUNNING]: "cancelled",
  [ScenarioRunStatus.PENDING_EVALUATION]: "cancelled",
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
  [ScenarioRunStatus.PENDING_EVALUATION]: "gray.solid/15",
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
    lightModeGradient: LIGHT_MODE_GRADIENTS[LIGHT_MODE_GRADIENT_BY_STATUS[status]],
    scrim: SCRIM_TOKENS[status],
  };
}

/**
 * Status treatment for completed simulation cards. Light mode uses a
 * full-card layered wash, while dark mode keeps the quieter bottom scrim.
 * Running cards get no overlay.
 */
export function SimulationStatusOverlay({ status }: { status: ScenarioRunStatus }) {
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
