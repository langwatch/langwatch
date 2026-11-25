import { HStack, Text, type Tokens } from "@langwatch/design-system/primitives";
import {
  SimulationRunStatus as ScenarioRunStatus,
  SimulationVerdict as Verdict,
} from "@langwatch/scenario-contract";

import {
  CONSOLE_COLORS,
  STATUS_DISPLAY_TEXT_MAP,
} from "../../../model/simulation-console/constants.ts";

interface StatusDisplayProps {
  status?: ScenarioRunStatus;
  verdict?: Verdict;
}

const STATUS_COLOR_MAP: Record<ScenarioRunStatus, Tokens["colors"]> = {
  [ScenarioRunStatus.SUCCESS]: "green.fg",
  [ScenarioRunStatus.FAILED]: "red.fg",
  [ScenarioRunStatus.ERROR]: "red.fg",
  [ScenarioRunStatus.CANCELLED]: "red.fg",
  [ScenarioRunStatus.IN_PROGRESS]: "yellow.fg",
  [ScenarioRunStatus.PENDING]: "yellow.fg",
  [ScenarioRunStatus.STALLED]: "yellow.fg",
  [ScenarioRunStatus.QUEUED]: "blue.fg",
  [ScenarioRunStatus.RUNNING]: "yellow.fg",
  [ScenarioRunStatus.PENDING_EVALUATION]: "yellow.fg",
};

export function StatusDisplay({ status, verdict }: StatusDisplayProps) {
  const getStatusColor = () => {
    if (verdict === Verdict.SUCCESS) return CONSOLE_COLORS.successColor;
    if (verdict === Verdict.FAILURE) return CONSOLE_COLORS.failureColor;
    if (verdict === Verdict.INCONCLUSIVE) return CONSOLE_COLORS.warningColor;
    if (status !== undefined) return STATUS_COLOR_MAP[status];
    return CONSOLE_COLORS.failureColor;
  };

  const getStatusText = () => {
    if (verdict === Verdict.SUCCESS) return "PASSED";
    if (verdict === Verdict.FAILURE) return "FAILED";
    if (verdict) return "INCONCLUSIVE";
    if (status !== undefined) {
      return STATUS_DISPLAY_TEXT_MAP[status];
    }
    return undefined;
  };

  return (
    <HStack>
      <Text color="fg">Status:</Text>
      <Text color={getStatusColor()} fontWeight="bold">
        {getStatusText()}
      </Text>
    </HStack>
  );
}
