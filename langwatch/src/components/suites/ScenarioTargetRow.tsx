/**
 * Row inside an expanded run showing a scenario x target pair result.
 *
 * Displays: [status_icon] [target: scenario_name (#N)] [passed/failed (met/total)] [duration] [cancel?]
 *
 * When the run is in a cancellable state (PENDING, IN_PROGRESS, STALLED),
 * a cancel button appears at the end of the row.
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */

import { HStack, Text } from "@chakra-ui/react";
import { Spinner } from "@chakra-ui/react";
import { X } from "lucide-react";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { SCENARIO_RUN_STATUS_CONFIG } from "~/components/simulations/scenario-run-status-config";
import { STATUS_ICON_CONFIG } from "./status-icons";
import { buildDisplayTitle } from "./run-history-transforms";
import { formatRunStatusLabel } from "./format-run-status-label";
import { isCancellableStatus } from "./useCancelScenarioRun";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";

type ScenarioTargetRowProps = {
  scenarioRun: ScenarioRunData;
  targetName: string | null;
  onClick: () => void;
  iteration?: number;
  onCancel?: () => void;
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StatusIcon({ status }: { status: ScenarioRunStatus }) {
  // Queued and running rows show a spinner instead of a pass/fail icon
  if (status === ScenarioRunStatus.QUEUED || status === ScenarioRunStatus.RUNNING) {
    return <Spinner size="xs" data-testid="queued-spinner" />;
  }

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
  iteration,
  onCancel,
}: ScenarioTargetRowProps) {
  const scenarioName = scenarioRun.name ?? scenarioRun.scenarioId;
  const displayName = buildDisplayTitle({ scenarioName, targetName, iteration });

  const config = SCENARIO_RUN_STATUS_CONFIG[scenarioRun.status];

  return (
    <HStack
      as="button"
      width="full"
      paddingX={4}
      paddingY={2}
      gap={3}
      _hover={{ bg: "bg.muted" }}
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
        <Text fontSize="xs" color={config.fgColor}>
          {formatRunStatusLabel({
            status: scenarioRun.status,
            results: scenarioRun.results ?? undefined,
          })}
        </Text>
        {scenarioRun.durationInMs > 0 && (
          <Text fontSize="xs" color="fg.muted">
            {formatDuration(scenarioRun.durationInMs)}
          </Text>
        )}
        {onCancel && isCancellableStatus(scenarioRun.status) && (
          <HStack
            as="span"
            role="button"
            tabIndex={0}
            gap={1}
            paddingX={2}
            paddingY={0.5}
            borderRadius="sm"
            fontSize="xs"
            color="red.500"
            cursor="pointer"
            _hover={{ bg: "red.50" }}
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              onCancel();
            }}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                e.preventDefault();
                onCancel();
              }
            }}
            aria-label="Cancel run"
            data-testid="cancel-run-button"
          >
            <X size={12} />
            <Text fontSize="xs">Cancel</Text>
          </HStack>
        )}
      </HStack>
    </HStack>
  );
}
