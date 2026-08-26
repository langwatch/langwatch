import type { Tokens } from "@chakra-ui/react";

import {
  SimulationRunStatus as ScenarioRunStatus,
  SimulationVerdict as Verdict,
} from "@langwatch/simulation-contract";

export const CONSOLE_COLORS: Record<string, Tokens["colors"]> = {
  consoleBg: "gray.950",
  consoleText: "gray.200",
  headerColor: "white",
  successColor: "green.300",
  failureColor: "red.400",
  warningColor: "yellow.400",
  pendingColor: "yellow.400",
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
};

export const REASONING_VERDICT_COLOR_MAP: Record<Verdict, Tokens["colors"]> = {
  [Verdict.SUCCESS]: "green.300",
  [Verdict.FAILURE]: "red.400",
  [Verdict.INCONCLUSIVE]: "yellow.400",
};
