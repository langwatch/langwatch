import { HStack, Text } from "@chakra-ui/react";
import {
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import { CONSOLE_COLORS, STATUS_DISPLAY_TEXT_MAP } from "./constants";

interface StatusDisplayProps {
  status?: string;
  verdict?: Verdict;
}

/**
 * Status display component
 * Single Responsibility: Displays scenario status and verdict with appropriate colors
 */
export function StatusDisplay({ status, verdict }: StatusDisplayProps) {
  const getStatusColor = () => {
    if (verdict === Verdict.SUCCESS) return CONSOLE_COLORS.successColor;
    if (verdict === Verdict.FAILURE) return CONSOLE_COLORS.failureColor;
    if (verdict === Verdict.INCONCLUSIVE) return CONSOLE_COLORS.warningColor;
    if (status === ScenarioRunStatus.IN_PROGRESS)
      return CONSOLE_COLORS.pendingColor;
    if (status === ScenarioRunStatus.SUCCESS)
      return CONSOLE_COLORS.successColor;

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
    return STATUS_DISPLAY_TEXT_MAP[
      status as keyof typeof STATUS_DISPLAY_TEXT_MAP
    ];
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
