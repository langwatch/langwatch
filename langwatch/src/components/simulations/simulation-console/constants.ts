import type { Tokens } from "@chakra-ui/react";

import {
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";

/**
 * Static console styling colors
 * Single Responsibility: Provides consistent color values for console components (dark mode only)
 */
export const CONSOLE_COLORS: Record<string, Tokens["colors"]> = {
  consoleBg: "gray.800",
  consoleText: "white",
  headerColor: "white",
  successColor: "green.300",
  failureColor: "red.400",
  warningColor: "yellow.400",
  pendingColor: "yellow.400",
};

/**
 * Mapping of scenario run status to display text
 * Single Responsibility: Provides consistent status text mapping
 */
export const STATUS_DISPLAY_TEXT_MAP: Record<ScenarioRunStatus, string> = {
  [ScenarioRunStatus.SUCCESS]: "SUCCESS",
  [ScenarioRunStatus.ERROR]: "ERROR",
  [ScenarioRunStatus.CANCELLED]: "CANCELLED",
  [ScenarioRunStatus.IN_PROGRESS]: "IN PROGRESS",
  [ScenarioRunStatus.PENDING]: "PENDING",
  [ScenarioRunStatus.FAILED]: "FAILED",
  [ScenarioRunStatus.STALLED]: "STALLED",
};

/**
 * Mapping of verdict to display text
 * Single Responsibility: Provides consistent verdict text mapping
 */
export const REASONING_VERDICT_COLOR_MAP: Record<Verdict, Tokens["colors"]> = {
  [Verdict.SUCCESS]: "green.300",
  [Verdict.FAILURE]: "red.400",
  [Verdict.INCONCLUSIVE]: "yellow.400",
};
