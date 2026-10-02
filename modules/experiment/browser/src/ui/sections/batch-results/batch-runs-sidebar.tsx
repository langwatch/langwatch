import { RawCheckbox as Checkbox } from "@langwatch/design-system/checkbox";
/**
 * BatchRunsSidebar - Sidebar component showing list of evaluation runs
 */
import {
  Alert,
  Box,
  Button,
  chakra,
  HStack,
  Skeleton,
  Spinner,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { nowInstant } from "@langwatch/time";
import { GitCompare, X } from "lucide-react";
import { useMemo } from "react";

import { getRunDisplayName } from "../../../model/batch-evaluation-results.run-display-name.ts";
import {
  INTERRUPTED_THRESHOLD_MS,
  isRunFinished,
} from "../../../model/batch-evaluation-results.run-state.ts";
import { RunDisplayName } from "../../elements/batch-results/run-display-name.tsx";
import { formatTimeAgo, getColorForString } from "./presentation.tsx";

/**
 * Summary data for a single evaluation run
 */
export type BatchRunSummary = {
  runId: string;
  workflowVersion?: {
    id: string;
    version: string;
    commitMessage: string;
  } | null;
  timestamps: {
    createdAt: number;
    updatedAt?: number | null;
    finishedAt?: number | null;
    stoppedAt?: number | null;
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

/**
 * Check if a run was interrupted (no explicit finish/stop but stale)
 */
const isRunInterrupted = (timestamps: BatchRunSummary["timestamps"]): boolean => {
  // Has explicit finish or stop - not interrupted
  if (timestamps.finishedAt ?? timestamps.stoppedAt) {
    return false;
  }

  // No updates for 5 minutes - considered interrupted
  if (timestamps.updatedAt) {
    const timeSinceUpdate = nowInstant().epochMilliseconds - timestamps.updatedAt;
    return timeSinceUpdate > INTERRUPTED_THRESHOLD_MS;
  }

  return false;
};

/** Red for stopped runs, orange for interrupted, otherwise the stable colour from the parent. */
const resolveRunColor = ({
  run,
  interrupted,
  runColors,
}: {
  run: BatchRunSummary;
  interrupted: boolean;
  runColors: Record<string, string>;
}): string => {
  if (run.timestamps.stoppedAt) return "red.400";
  if (interrupted) return "orange.400";
  return runColors[run.runId] ?? getColorForString("colors", run.runId).color;
};

/** Runs newest-first for display, numbered oldest-first so "Run #N" stays stable. */
const runListOf = (runs: BatchRunSummary[]) => {
  const chronological = runs.toSorted((a, b) => a.timestamps.createdAt - b.timestamps.createdAt);
  return {
    sortedRuns: chronological.toReversed(),
    chronologicalIndexMap: new Map(chronological.map((run, i) => [run.runId, i])),
  };
};

const SidebarSkeleton = () => (
  <VStack gap={0.5} align="stretch" paddingX={2}>
    {Array.from({ length: 6 }).map((_, index) => (
      <HStack key={index} paddingX={2} paddingY={2} gap={2}>
        <VStack align="start" gap={1} flex={1} minWidth={0}>
          <HStack gap={1} width="100%">
            <Skeleton width="10px" height="10px" borderRadius="sm" />
            <Skeleton height="13px" width="calc(100% - 14px)" />
          </HStack>
          <Skeleton height="12px" width="full" />
        </VStack>
      </HStack>
    ))}
  </VStack>
);

const CompareToggle = ({
  compareMode,
  canCompare,
  onToggle,
}: {
  compareMode: boolean;
  canCompare: boolean;
  onToggle: () => void;
}) => {
  if (compareMode) {
    return (
      <Button size="xs" variant="outline" onClick={onToggle} data-testid="exit-compare-button">
        <X size={14} />
        Exit
      </Button>
    );
  }
  return (
    <Tooltip
      content={
        canCompare ? "Compare runs (or Shift+click another run)" : "Need at least 2 runs to compare"
      }
      positioning={{ placement: "right" }}
    >
      <Button
        size="xs"
        variant="outline"
        onClick={onToggle}
        disabled={!canCompare}
        data-testid="compare-button"
      >
        <GitCompare size={14} />
        Compare
      </Button>
    </Tooltip>
  );
};

type RunItemProps = {
  run: BatchRunSummary;
  chronologicalIndex: number;
  isHighlighted: boolean;
  isSelectedForComparison: boolean;
  runColors: Record<string, string>;
  onClick: (event: React.MouseEvent) => void;
  onToggleSelection?: () => void;
};

const RunItem = ({
  run,
  chronologicalIndex,
  isHighlighted,
  isSelectedForComparison,
  runColors,
  onClick,
  onToggleSelection,
}: RunItemProps) => {
  const interrupted = isRunInterrupted(run.timestamps);
  const runColor = resolveRunColor({ run, interrupted, runColors });
  const runName = getRunDisplayName({
    commitMessage: run.workflowVersion?.commitMessage,
    runId: run.runId,
    index: chronologicalIndex,
  });
  return (
    <HStack
      bg={isHighlighted ? "blue.subtle" : "transparent"}
      color={isHighlighted ? "blue.fg" : "fg"}
      borderRadius="md"
      _hover={{ bg: isHighlighted ? "blue.muted" : "bg.muted" }}
      gap={0}
      data-testid={`run-item-${run.runId}`}
    >
      {onToggleSelection && (
        <Checkbox.Root
          size="sm"
          paddingLeft={2}
          checked={isSelectedForComparison}
          onCheckedChange={onToggleSelection}
          data-testid={`run-checkbox-${run.runId}`}
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
        </Checkbox.Root>
      )}
      <chakra.button
        type="button"
        onClick={onClick}
        display="flex"
        flexDirection="column"
        alignItems="start"
        textAlign="left"
        flex={1}
        minWidth={0}
        paddingX={2}
        paddingY={2}
        cursor="pointer"
      >
        <HStack gap={1} width="100%">
          <Tooltip content={runName} positioning={{ placement: "top" }} openDelay={500}>
            <HStack gap={1} flex={1} minWidth={0} width="100%">
              <Box width="10px" height="10px" borderRadius="sm" bg={runColor} flexShrink={0} />
              <Text
                fontSize="13px"
                fontWeight="medium"
                lineClamp={1}
                wordBreak="break-all"
                flex={1}
                minWidth={0}
              >
                <RunDisplayName
                  commitMessage={run.workflowVersion?.commitMessage}
                  runId={run.runId}
                  index={chronologicalIndex}
                />
              </Text>
            </HStack>
          </Tooltip>
          {run.workflowVersion?.version && (
            <Text fontSize="10px" fontWeight="600" color="fg.muted" flexShrink={0}>
              v{run.workflowVersion.version}
            </Text>
          )}
          {!isRunFinished(run.timestamps) && <Spinner size="xs" color="blue.500" flexShrink={0} />}
        </HStack>
        <Text color="fg.muted" fontSize="12px">
          {run.timestamps.createdAt ? formatTimeAgo(run.timestamps.createdAt) : "..."}
          {run.timestamps.stoppedAt && " · stopped"}
          {interrupted && " · interrupted"}
        </Text>
      </chakra.button>
    </HStack>
  );
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

  // Sort runs newest-first for display, and build a chronological index map
  // so "Run #N" numbering stays stable (Run #1 = oldest, Run #N = newest)
  const { sortedRuns, chronologicalIndexMap } = useMemo(() => runListOf(runs), [runs]);

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
      <HStack paddingX={3} paddingBottom={2} justify="space-between" align="center">
        <Text fontSize="sm" fontWeight="semibold" color="fg">
          Experiment Runs
        </Text>
        {onToggleCompareMode && (
          <CompareToggle
            compareMode={compareMode}
            canCompare={canCompare}
            onToggle={onToggleCompareMode}
          />
        )}
      </HStack>

      {/* Loading state */}
      {isLoading && <SidebarSkeleton />}

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
        <Text paddingX={3} paddingY={4} color="fg.muted" fontSize="sm">
          No runs yet
        </Text>
      )}

      {/* Run list - Apple Notes style */}
      <VStack gap={0.5} align="stretch" paddingX={2}>
        {!isLoading &&
          !error &&
          sortedRuns.map((run) => {
            const isSelectedForComparison = selectedRunIds.includes(run.runId);
            return (
              <RunItem
                key={run.runId}
                run={run}
                chronologicalIndex={chronologicalIndexMap.get(run.runId) ?? 0}
                isHighlighted={
                  (compareMode && isSelectedForComparison) || selectedRunId === run.runId
                }
                isSelectedForComparison={isSelectedForComparison}
                runColors={runColors}
                onClick={(e) => handleRunClick(run.runId, e)}
                onToggleSelection={
                  compareMode && onToggleRunSelection
                    ? () => onToggleRunSelection(run.runId)
                    : undefined
                }
              />
            );
          })}
      </VStack>
    </VStack>
  );
}
