/**
 * BatchRunsSidebar - Sidebar component showing list of evaluation runs
 *
 * Modern design matching the prompt playground sidebar style:
 * - No borders on the sidebar itself
 * - Items have rounded corners that don't touch edges
 * - Two-line Apple Notes style layout
 * - formatTimeAgo for relative dates
 */
import {
  Alert,
  Box,
  Button,
  Checkbox,
  HStack,
  Skeleton,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { WorkflowVersion } from "@prisma/client";
import { GitCompare, X } from "lucide-react";

import { Tooltip } from "~/components/ui/tooltip";
import { FormatMoney } from "~/optimization_studio/components/FormatMoney";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { getColorForString } from "~/utils/rotatingColors";

/**
 * Summary data for a single evaluation run
 */
export type BatchRunSummary = {
  runId: string;
  workflowVersion?: Pick<
    WorkflowVersion,
    "id" | "version" | "commitMessage"
  > | null;
  timestamps: {
    created_at: number;
    updated_at?: number | null;
    finished_at?: number | null;
    stopped_at?: number | null;
  };
  progress?: number | null;
  total?: number | null;
  summary: {
    datasetCost?: number | null;
    evaluationsCost?: number | null;
    evaluations: Record<
      string,
      {
        name: string;
        averageScore?: number | null;
        averagePassed?: number | null;
      }
    >;
  };
};

type BatchRunsSidebarProps = {
  /** List of runs to display */
  runs: BatchRunSummary[];
  /** Currently selected run ID */
  selectedRunId?: string;
  /** Callback when a run is selected */
  onSelectRun: (runId: string) => void;
  /** Loading state */
  isLoading?: boolean;
  /** Error message */
  error?: string | null;
  /** Size variant */
  size?: "sm" | "md";
  /** Whether compare mode is active */
  compareMode?: boolean;
  /** Callback to toggle compare mode */
  onToggleCompareMode?: () => void;
  /** Selected run IDs for comparison */
  selectedRunIds?: string[];
  /** Callback to toggle a run selection for comparison */
  onToggleRunSelection?: (runId: string) => void;
  /** Callback to enter compare mode with two specific runs (for shift+click) */
  onEnterCompareWithRuns?: (runId1: string, runId2: string) => void;
  /** Color map for runs in comparison mode (runId -> color) */
  runColors?: Record<string, string>;
};

/** Time in milliseconds after which a run without updates is considered interrupted */
const INTERRUPTED_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check if a run is finished (completed, stopped, or interrupted)
 */
const isRunFinished = (timestamps: BatchRunSummary["timestamps"]): boolean => {
  // Explicitly finished or stopped
  if (timestamps.finished_at ?? timestamps.stopped_at) {
    return true;
  }

  // Consider interrupted if no updates for 5 minutes
  if (timestamps.updated_at) {
    const timeSinceUpdate = Date.now() - timestamps.updated_at;
    if (timeSinceUpdate > INTERRUPTED_THRESHOLD_MS) {
      return true;
    }
  }

  return false;
};

/**
 * Check if a run was interrupted (no explicit finish/stop but stale)
 */
const isRunInterrupted = (
  timestamps: BatchRunSummary["timestamps"],
): boolean => {
  // Has explicit finish or stop - not interrupted
  if (timestamps.finished_at ?? timestamps.stopped_at) {
    return false;
  }

  // No updates for 5 minutes - considered interrupted
  if (timestamps.updated_at) {
    const timeSinceUpdate = Date.now() - timestamps.updated_at;
    return timeSinceUpdate > INTERRUPTED_THRESHOLD_MS;
  }

  return false;
};

/**
 * Format evaluation summary for display
 */
const formatEvalSummary = (
  evaluation: {
    name: string;
    averageScore?: number | null;
    averagePassed?: number | null;
  },
  compact = false,
): string => {
  if (
    evaluation.averagePassed !== undefined &&
    evaluation.averagePassed !== null
  ) {
    const pct = Math.round(evaluation.averagePassed * 100);
    return compact ? `${pct}%` : `${pct}% passed`;
  }
  if (
    evaluation.averageScore !== undefined &&
    evaluation.averageScore !== null
  ) {
    const score = evaluation.averageScore.toFixed(2);
    return compact ? score : `avg ${score}`;
  }
  return "-";
};

export function BatchRunsSidebar({
  runs,
  selectedRunId,
  onSelectRun,
  isLoading,
  error,
  size = "md",
  compareMode = false,
  onToggleCompareMode,
  selectedRunIds = [],
  onToggleRunSelection,
  onEnterCompareWithRuns,
  runColors = {},
}: BatchRunsSidebarProps) {
  const canCompare = runs.length >= 2;

  // Handle click with shift key for compare mode
  const handleRunClick = (runId: string, event: React.MouseEvent) => {
    // Prevent text selection on shift+click
    if (event.shiftKey) {
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
    }

    if (compareMode && onToggleRunSelection) {
      onToggleRunSelection(runId);
    } else if (
      event.shiftKey &&
      selectedRunId &&
      onEnterCompareWithRuns &&
      runId !== selectedRunId
    ) {
      // Shift+click enters compare mode with current and clicked run
      onEnterCompareWithRuns(selectedRunId, runId);
    } else {
      onSelectRun(runId);
    }
  };

  return (
    <VStack
      align="stretch"
      paddingY={2}
      fontSize="14px"
      minWidth={size === "sm" ? "220px" : "260px"}
      maxWidth={size === "sm" ? "220px" : "260px"}
      height="full"
      gap={0}
      overflowY="auto"
    >
      {/* Header with title and compare button */}
      <HStack
        paddingX={3}
        paddingBottom={2}
        justify="space-between"
        align="center"
      >
        <Text fontSize="sm" fontWeight="semibold" color="gray.700">
          Experiment Runs
        </Text>
        {onToggleCompareMode && (
          <>
            {compareMode ? (
              <Button
                size="xs"
                variant="outline"
                onClick={onToggleCompareMode}
                data-testid="exit-compare-button"
              >
                <X size={14} />
                Exit
              </Button>
            ) : (
              <Tooltip
                content={
                  canCompare
                    ? "Compare runs (or Shift+click another run)"
                    : "Need at least 2 runs to compare"
                }
                positioning={{ placement: "right" }}
              >
                <Button
                  size="xs"
                  variant="outline"
                  onClick={onToggleCompareMode}
                  disabled={!canCompare}
                  data-testid="compare-button"
                >
                  <GitCompare size={14} />
                  Compare
                </Button>
              </Tooltip>
            )}
          </>
        )}
      </HStack>

      {/* Loading state */}
      {isLoading && (
        <VStack gap={0.5} align="stretch" paddingX={2}>
          {Array.from({ length: 6 }).map((_, index) => (
            <HStack key={index} paddingX={2} paddingY={2} gap={2}>
              <VStack align="start" gap={1} flex={1} minWidth={0}>
                {/* Line 1: Color square + name + version */}
                <HStack gap={1} width="100%">
                  <Skeleton width="10px" height="10px" borderRadius="sm" />
                  <Skeleton height="13px" width="calc(100% - 14px)" />
                </HStack>
                {/* Line 2: Time ago */}
                <Skeleton height="12px" width="full" />
              </VStack>
            </HStack>
          ))}
        </VStack>
      )}

      {/* Error state */}
      {error && (
        <Box paddingX={2}>
          <Alert.Root status="error">
            <Alert.Indicator />
            {error}
          </Alert.Root>
        </Box>
      )}

      {/* Empty state */}
      {!isLoading && !error && runs.length === 0 && (
        <Text paddingX={3} paddingY={4} color="gray.500" fontSize="sm">
          No runs yet
        </Text>
      )}

      {/* Run list - Apple Notes style */}
      <VStack gap={0.5} align="stretch" paddingX={2}>
        {!isLoading &&
          !error &&
          runs.map((run) => {
            const isSelected = selectedRunId === run.runId;
            const isFinished = isRunFinished(run.timestamps);
            const _runCost =
              (run.summary.datasetCost ?? 0) +
              (run.summary.evaluationsCost ?? 0);

            // Build the name - prefer commit message, then just run ID
            const runName = run.workflowVersion?.commitMessage
              ? run.workflowVersion.commitMessage
              : run.runId;

            // Build summary line: evaluator scores + cost (filter out "-" values)
            const summaryParts: string[] = [];
            Object.values(run.summary.evaluations)
              .slice(0, 2)
              .forEach((ev) => {
                const summary = formatEvalSummary(ev, true);
                if (summary !== "-") {
                  summaryParts.push(summary);
                }
              });

            const isSelectedForComparison = selectedRunIds.includes(run.runId);
            const interrupted = isRunInterrupted(run.timestamps);

            // Use stable color from parent (based on position in full runs list)
            // Override with red for stopped runs, orange for interrupted
            const runColor = run.timestamps.stopped_at
              ? "red.400"
              : interrupted
                ? "orange.400"
                : (runColors[run.runId] ??
                  getColorForString("colors", run.runId).color);

            return (
              <HStack
                key={run.runId}
                paddingX={2}
                paddingY={2}
                cursor="pointer"
                role="button"
                bg={
                  compareMode && isSelectedForComparison
                    ? "blue.50"
                    : isSelected
                      ? "blue.50"
                      : "transparent"
                }
                color={
                  compareMode && isSelectedForComparison
                    ? "blue.700"
                    : isSelected
                      ? "blue.700"
                      : "gray.700"
                }
                borderRadius="md"
                _hover={{
                  bg:
                    compareMode && isSelectedForComparison
                      ? "blue.100"
                      : isSelected
                        ? "blue.100"
                        : "gray.100",
                }}
                onClick={(e) => handleRunClick(run.runId, e)}
                gap={2}
                data-testid={`run-item-${run.runId}`}
              >
                {/* Checkbox in compare mode */}
                {compareMode && onToggleRunSelection && (
                  <Checkbox.Root
                    size="sm"
                    checked={isSelectedForComparison}
                    onCheckedChange={() => onToggleRunSelection(run.runId)}
                    onClick={(e) => e.stopPropagation()}
                    data-testid={`run-checkbox-${run.runId}`}
                  >
                    <Checkbox.HiddenInput />
                    <Checkbox.Control />
                  </Checkbox.Root>
                )}

                <VStack align="start" gap={0} flex={1} minWidth={0}>
                  {/* Line 1: Name + version badge + spinner */}
                  <HStack gap={1} width="100%">
                    <Tooltip
                      content={runName}
                      positioning={{ placement: "top" }}
                      openDelay={500}
                    >
                      <HStack gap={1}>
                        {/* Small color indicator square */}
                        <Box
                          width="10px"
                          height="10px"
                          borderRadius="sm"
                          bg={runColor}
                          flexShrink={0}
                        />
                        <Text
                          fontSize="13px"
                          fontWeight="medium"
                          lineClamp={1}
                          wordBreak="break-all"
                          flex={1}
                        >
                          {runName}
                        </Text>
                      </HStack>
                    </Tooltip>
                    {run.workflowVersion?.version && (
                      <Text
                        fontSize="10px"
                        fontWeight="600"
                        color="gray.500"
                        flexShrink={0}
                      >
                        v{run.workflowVersion.version}
                      </Text>
                    )}
                    {!isFinished && (
                      <Spinner size="xs" color="blue.500" flexShrink={0} />
                    )}
                  </HStack>

                  {/* Line 2: Time ago + status */}
                  <Text color="gray.500" fontSize="12px">
                    {run.timestamps.created_at
                      ? formatTimeAgo(run.timestamps.created_at)
                      : "..."}
                    {run.timestamps.stopped_at && " · stopped"}
                    {interrupted && " · interrupted"}
                  </Text>
                </VStack>
              </HStack>
            );
          })}
      </VStack>
    </VStack>
  );
}
