/**
 * Row inside an expanded run showing a scenario x target pair result.
 *
 * Displays: [status_icon] [scenario_name] x [target_name] [pass%] ([pass/total]) [duration]
 */

import { HStack, Text } from "@chakra-ui/react";
import { CheckCircle, XCircle, Loader } from "lucide-react";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";

type ScenarioTargetRowProps = {
  scenarioRun: ScenarioRunData;
  targetName: string | null;
  onClick: () => void;
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

type StatusCategory = "success" | "failure" | "in_progress";

function categorizeStatus(status: ScenarioRunStatus): StatusCategory {
  switch (status) {
    case ScenarioRunStatus.SUCCESS:
      return "success";
    case ScenarioRunStatus.ERROR:
    case ScenarioRunStatus.FAILED:
    case ScenarioRunStatus.STALLED:
    case ScenarioRunStatus.CANCELLED:
      return "failure";
    case ScenarioRunStatus.IN_PROGRESS:
    case ScenarioRunStatus.PENDING:
      return "in_progress";
  }
}

function StatusIcon({ status }: { status: ScenarioRunStatus }) {
  switch (categorizeStatus(status)) {
    case "success":
      return <CheckCircle size={14} color="var(--chakra-colors-green-500)" />;
    case "failure":
      return <XCircle size={14} color="var(--chakra-colors-red-500)" />;
    case "in_progress":
      return <Loader size={14} color="var(--chakra-colors-orange-500)" style={{ animation: "spin 2s linear infinite" }} />;
  }
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

  const category = categorizeStatus(scenarioRun.status);

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
        {category !== "in_progress" && (
          <Text fontSize="xs" color={category === "success" ? "green.600" : "red.600"}>
            {category === "success" ? "100%" : "0%"}
          </Text>
        )}
        {category === "in_progress" && (
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
