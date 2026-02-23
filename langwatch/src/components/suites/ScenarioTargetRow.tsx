/**
 * Row inside an expanded run showing a scenario x target pair result.
 *
 * Displays: [status_icon] [scenario_name] x [target_name] [pass%] ([pass/total]) [duration]
 */

import { HStack, Text } from "@chakra-ui/react";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { SCENARIO_RUN_STATUS_CONFIG } from "~/server/scenarios/status-config";
import { STATUS_ICON_CONFIG } from "./status-icons";
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

function StatusIcon({ status }: { status: ScenarioRunStatus }) {
  const config = SCENARIO_RUN_STATUS_CONFIG[status];
  const iconConfig = STATUS_ICON_CONFIG[status];
  const Icon = iconConfig.icon;
  return (
    <Icon
      size={14}
      color={`var(--chakra-colors-${config.colorPalette}-500)`}
      style={iconConfig.animate ? { animation: "spin 2s linear infinite" } : undefined}
    />
  );
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

  const config = SCENARIO_RUN_STATUS_CONFIG[scenarioRun.status];

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
        {config.isComplete ? (
          <Text fontSize="xs" color={config.fgColor}>
            {scenarioRun.status === ScenarioRunStatus.SUCCESS ? "100%" : config.label}
          </Text>
        ) : (
          <Text fontSize="xs" color={config.fgColor}>
            {config.label}
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
