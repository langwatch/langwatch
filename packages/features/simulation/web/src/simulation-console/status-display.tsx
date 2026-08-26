import { HStack, Text, type Tokens } from "@chakra-ui/react";
import {
  SimulationRunStatus as ScenarioRunStatus,
  SimulationVerdict as Verdict,
} from "@langwatch/simulation-contract";
import { CONSOLE_COLORS, STATUS_DISPLAY_TEXT_MAP } from "./constants";

interface StatusDisplayProps {
  status?: ScenarioRunStatus;
  verdict?: Verdict;
}

const STATUS_COLOR_MAP: Record<ScenarioRunStatus, Tokens["colors"]> = {
  [ScenarioRunStatus.SUCCESS]: "green.300",
  [ScenarioRunStatus.FAILED]: "red.400",
  [ScenarioRunStatus.ERROR]: "red.400",
  [ScenarioRunStatus.CANCELLED]: "red.400",
  [ScenarioRunStatus.IN_PROGRESS]: "yellow.400",
  [ScenarioRunStatus.PENDING]: "yellow.400",
  [ScenarioRunStatus.STALLED]: "yellow.400",
  [ScenarioRunStatus.QUEUED]: "blue.400",
  [ScenarioRunStatus.RUNNING]: "yellow.400",
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
    if (verdict) {
      return verdict === Verdict.SUCCESS
        ? "PASSED"
        : verdict === Verdict.FAILURE
          ? "FAILED"
          : "INCONCLUSIVE";
    }
    if (status !== undefined) {
      return STATUS_DISPLAY_TEXT_MAP[status];
    }
    return undefined;
  };

  return (
    <HStack>
      <Text color="white">Status:</Text>
      <Text color={getStatusColor()} fontWeight="bold">
        {getStatusText()}
      </Text>
    </HStack>
  );
}
