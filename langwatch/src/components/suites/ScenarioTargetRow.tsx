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

import { Box, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { X } from "lucide-react";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { SCENARIO_RUN_STATUS_CONFIG } from "~/components/simulations/scenario-run-status-config";
import { buildDisplayTitle } from "./run-history-transforms";
import { formatRunStatusLabel } from "./format-run-status-label";
import { formatCost, formatLatency } from "~/components/shared/formatters";
import { Tooltip } from "~/components/ui/tooltip";
import { isCancellableStatus } from "./useCancelScenarioRun";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";

type ScenarioTargetRowProps = {
  scenarioRun: ScenarioRunData;
  targetName: string | null;
  onClick: () => void;
  iteration?: number;
  onCancel?: () => void;
  isCancelling?: boolean;
};

const STATUS_CIRCLE_COLORS: Record<string, string> = {
  [ScenarioRunStatus.SUCCESS]: "green.500",
  [ScenarioRunStatus.FAILED]: "red.500",
  [ScenarioRunStatus.ERROR]: "red.500",
  [ScenarioRunStatus.STALLED]: "yellow.500",
  [ScenarioRunStatus.CANCELLED]: "gray.400",
  [ScenarioRunStatus.IN_PROGRESS]: "orange.400",
  [ScenarioRunStatus.PENDING]: "gray.400",
  [ScenarioRunStatus.QUEUED]: "blue.400",
  [ScenarioRunStatus.RUNNING]: "orange.400",
};

function MetricsTooltipContent({ scenarioRun }: { scenarioRun: ScenarioRunData }) {
  const roleCosts = scenarioRun.roleCosts ?? {};
  const roleLatencies = scenarioRun.roleLatencies ?? {};
  const roles = [...new Set([...Object.keys(roleCosts), ...Object.keys(roleLatencies)])];

  return (
    <VStack align="stretch" gap={0} fontSize="12px" minWidth="180px" color="white">
      <VStack align="stretch" gap={2} padding={2}>
        {/* Total duration */}
        {scenarioRun.durationInMs > 0 && (
          <HStack justify="space-between">
            <Text color="white/75">Duration</Text>
            <Text fontWeight="medium">{formatLatency(scenarioRun.durationInMs)}</Text>
          </HStack>
        )}

        {/* Total cost */}
        {scenarioRun.totalCost != null && (
          <HStack justify="space-between">
            <Text color="white/75">Total Cost</Text>
            <Text fontWeight="medium">{formatCost(scenarioRun.totalCost)}</Text>
          </HStack>
        )}

        {/* Per-role breakdown */}
        {roles.length > 0 && (
          <>
            <Box borderTopWidth="1px" borderColor="border.emphasized" marginX={-2} />
            {roles.map((role) => (
              <HStack key={role} justify="space-between">
                <Text color="white/75">{role}</Text>
                <HStack gap={2}>
                  {roleLatencies[role] != null && (
                    <Text fontWeight="medium">{formatLatency(roleLatencies[role]!)}</Text>
                  )}
                  {roleCosts[role] != null && (
                    <Text fontWeight="medium">{formatCost(roleCosts[role]!)}</Text>
                  )}
                </HStack>
              </HStack>
            ))}
          </>
        )}
      </VStack>
    </VStack>
  );
}

function StatusCircle({ status }: { status: ScenarioRunStatus }) {
  if (status === ScenarioRunStatus.QUEUED || status === ScenarioRunStatus.RUNNING) {
    return <Spinner size="xs" data-testid="queued-spinner" />;
  }

  return (
    <Box
      width="10px"
      height="10px"
      borderRadius="full"
      bg={STATUS_CIRCLE_COLORS[status] ?? "gray.400"}
      flexShrink={0}
    />
  );
}

export function ScenarioTargetRow({
  scenarioRun,
  targetName,
  onClick,
  iteration,
  onCancel,
  isCancelling = false,
}: ScenarioTargetRowProps) {
  const scenarioName = scenarioRun.name ?? scenarioRun.scenarioId;
  const displayName = buildDisplayTitle({ scenarioName, targetName, iteration });

  const config = SCENARIO_RUN_STATUS_CONFIG[scenarioRun.status];

  const hasCancelButton = onCancel && isCancellableStatus(scenarioRun.status);
  const hasMetrics = scenarioRun.durationInMs > 0 || scenarioRun.totalCost != null;

  return (
    <Box
      position="relative"
      className="group"
      borderBottom="1px solid"
      _last={{ border: "none" }}
      borderColor="border.subtle"
      _hover={{ borderColor: "transparent" }}
    >
      <HStack
        as="button"
        width="full"
        paddingX={4}
        paddingY={2}
        paddingRight={hasCancelButton ? 20 : 4}
        gap={4}
        _hover={{ bg: "bg.muted/80" }}
        borderRadius="lg"
        cursor="pointer"
        onClick={onClick}
        tabIndex={0}
        aria-label={`View details for ${displayName}`}
      >
        <HStack>
          <StatusCircle status={scenarioRun.status} />
          <Text fontSize="xs" fontWeight="semibold" color={config.fgColor} width="43px">
            {formatRunStatusLabel({
              status: scenarioRun.status,
              results: scenarioRun.results ?? undefined,
            })}
          </Text>
        </HStack>
        <Text fontSize="sm" flex={1} textAlign="left" truncate>
          {displayName}
        </Text>
        {hasMetrics && (
          <Tooltip
            content={<MetricsTooltipContent scenarioRun={scenarioRun} />}
            contentProps={{ padding: 0 }}
            positioning={{ placement: "bottom" }}
            interactive
          >
            <HStack gap={2} flexShrink={0} color="fg.subtle">
              {scenarioRun.durationInMs > 0 && (
                <Text fontSize="11px">
                  {formatLatency(scenarioRun.durationInMs)}
                </Text>
              )}
              {scenarioRun.totalCost != null && (
                <>
                  <Text color="gray.300">{"⋅"}</Text>
                  <Text fontSize="xs">
                    {formatCost(scenarioRun.totalCost)}
                  </Text>
                </>
              )}
            </HStack>
          </Tooltip>
        )}
      </HStack>
      {hasCancelButton && (
        <HStack
          as="button"
          tabIndex={isCancelling ? -1 : 0}
          gap={1}
          paddingX={2}
          paddingY={0.5}
          borderRadius="sm"
          fontSize="xs"
          color="red.500"
          cursor={isCancelling ? "default" : "pointer"}
          opacity={isCancelling ? 0.6 : 0}
          pointerEvents={isCancelling ? "auto" : "none"}
          transition="opacity 0.15s"
          _groupHover={isCancelling ? { opacity: 0.6 } : { opacity: 1, pointerEvents: "auto" }}
          _hover={isCancelling ? undefined : { bg: "red.50" }}
          position="absolute"
          top="50%"
          right={4}
          transform="translateY(-50%)"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            if (!isCancelling) onCancel?.();
          }}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (!isCancelling && (e.key === "Enter" || e.key === " ")) {
              e.stopPropagation();
              e.preventDefault();
              onCancel?.();
            }
          }}
          aria-label="Cancel run"
          aria-disabled={isCancelling}
          data-testid="cancel-run-button"
        >
          {isCancelling ? <Spinner size="xs" /> : <X size={12} />}
          <Text fontSize="xs">Cancel</Text>
        </HStack>
      )}
    </Box>
  );
}
