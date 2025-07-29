import { ScenarioRunStatus } from "~/app/api/scenario-events/[[...route]]/enums";

/**
 * Static console styling colors
 * Single Responsibility: Provides consistent color values for console components (dark mode only)
 */
export const CONSOLE_COLORS = {
  consoleBg: "gray.800",
  consoleText: "green.300",
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
};
