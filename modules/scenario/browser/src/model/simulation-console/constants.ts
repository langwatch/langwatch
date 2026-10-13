import type { Tokens } from "@langwatch/design-system/primitives";
import {
  SimulationRunStatus as ScenarioRunStatus,
  SimulationVerdict as Verdict,
} from "@langwatch/scenario-contract";

export const CONSOLE_COLORS: Record<string, Tokens["colors"]> = {
  consoleBg: "bg.panel",
  consoleText: "fg",
  headerColor: "fg",
  successColor: "green.fg",
  failureColor: "red.fg",
  warningColor: "yellow.fg",
  pendingColor: "yellow.fg",
};

export const STATUS_DISPLAY_TEXT_MAP: Record<ScenarioRunStatus, string> = {
  [ScenarioRunStatus.SUCCESS]: "SUCCESS",
  [ScenarioRunStatus.ERROR]: "ERROR",
  [ScenarioRunStatus.CANCELLED]: "CANCELLED",
  [ScenarioRunStatus.IN_PROGRESS]: "IN PROGRESS",
  [ScenarioRunStatus.PENDING]: "PENDING",
  [ScenarioRunStatus.FAILED]: "FAILED",
  [ScenarioRunStatus.STALLED]: "STALLED",
  [ScenarioRunStatus.QUEUED]: "QUEUED",
  [ScenarioRunStatus.RUNNING]: "RUNNING",
  [ScenarioRunStatus.PENDING_EVALUATION]: "EVALUATING",
};

export const REASONING_VERDICT_COLOR_MAP: Record<Verdict, Tokens["colors"]> = {
  [Verdict.SUCCESS]: "green.fg",
  [Verdict.FAILURE]: "red.fg",
  [Verdict.INCONCLUSIVE]: "yellow.fg",
};
