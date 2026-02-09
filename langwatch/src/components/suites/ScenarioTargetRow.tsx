/**
 * Row inside an expanded run showing a scenario x target pair result.
 *
 * Displays: [status_icon] [scenario_name] x [target_name] [pass%] ([pass/total]) [duration]
 */

import { HStack, Text } from "@chakra-ui/react";
import { CheckCircle, XCircle, Loader } from "lucide-react";
import { ScenarioRunStatus } from "~/app/api/scenario-events/[[...route]]/enums";
import type { ScenarioRunData } from "~/app/api/scenario-events/[[...route]]/types";

type ScenarioTargetRowProps = {
  scenarioRun: ScenarioRunData;
  targetName: string | null;
  onClick: () => void;
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StatusIcon({ status }: { status: string }) {
  if (status === ScenarioRunStatus.SUCCESS) {
    return <CheckCircle size={14} color="var(--chakra-colors-green-500)" />;
  }
  if (
    status === ScenarioRunStatus.ERROR ||
    status === ScenarioRunStatus.FAILED
  ) {
    return <XCircle size={14} color="var(--chakra-colors-red-500)" />;
  }
  return <Loader size={14} color="var(--chakra-colors-orange-500)" />;
}

export function ScenarioTargetRow({
  scenarioRun,
  targetName,
  onClick,
}: ScenarioTargetRowProps) {
  const scenarioName = scenarioRun.name ?? scenarioRun.scenarioId;
  const displayName = targetName
    ? `${scenarioName} \u00d7 ${targetName}`
    : scenarioName;

  const isSuccess = scenarioRun.status === ScenarioRunStatus.SUCCESS;
  const isFinished =
    scenarioRun.status === ScenarioRunStatus.SUCCESS ||
    scenarioRun.status === ScenarioRunStatus.ERROR ||
    scenarioRun.status === ScenarioRunStatus.FAILED;

  return (
    <HStack
      as="button"
      width="full"
      paddingX={4}
      paddingY={2}
      gap={3}
      _hover={{ bg: "bg.subtle" }}
      cursor="pointer"
      onClick={onClick}
      borderBottom="1px solid"
      borderColor="border.subtle"
      role="button"
      tabIndex={0}
      aria-label={`View details for ${displayName}`}
    >
      <StatusIcon status={scenarioRun.status} />
      <Text fontSize="sm" flex={1} textAlign="left" truncate>
        {displayName}
      </Text>
      <HStack gap={2} flexShrink={0}>
        {isFinished && (
          <Text fontSize="xs" color={isSuccess ? "green.600" : "red.600"}>
            {isSuccess ? "100%" : "0%"}
          </Text>
        )}
        {!isFinished && (
          <Text fontSize="xs" color="orange.500">
            In progress
          </Text>
        )}
        {scenarioRun.durationInMs > 0 && (
          <Text fontSize="xs" color="fg.muted">
            {formatDuration(scenarioRun.durationInMs)}
          </Text>
        )}
      </HStack>
    </HStack>
  );
}
