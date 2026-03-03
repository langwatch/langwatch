/**
 * Collapsible row for a grouped set of scenario runs.
 *
 * Used when group-by is set to "scenario" or "target".
 * Header: [chevron] [group_name (bold)] [status_icon] [pass_rate] ... [N runs]
 * Footer: [N passed] [N failed]
 * Expanded: sub-grouped by batch, each with a lightweight header showing
 * timestamp and pass rate, then ScenarioTargetRow (list) or ScenarioGridCard (grid).
 *
 * The header is rendered as a direct child of the scroll container (no wrapper Box)
 * so that `position: sticky` works correctly within the scrollport.
 */

import { Box, Grid, HStack, Text, VStack } from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { SummaryStatusIcon } from "./SummaryStatusIcon";
import type { RunGroup, RunGroupSummary } from "./run-history-transforms";
import {
  computeBatchRunSummary,
  computeIterationMap,
  groupRunsByBatchId,
} from "./run-history-transforms";
import { ScenarioTargetRow } from "./ScenarioTargetRow";
import { ScenarioGridCard } from "./ScenarioGridCard";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import type { ViewMode } from "./useRunHistoryStore";

type GroupRowProps = {
  group: RunGroup;
  summary: RunGroupSummary;
  isExpanded: boolean;
  onToggle: () => void;
  onScenarioRunClick: (scenarioRun: ScenarioRunData) => void;
  resolveTargetName: (scenarioRun: ScenarioRunData) => string | null;
  viewMode?: ViewMode;
};

export function GroupRow({
  group,
  summary,
  isExpanded,
  onToggle,
  onScenarioRunClick,
  resolveTargetName,
  viewMode = "grid",
}: GroupRowProps) {
  const runCount = group.scenarioRuns.length;

  const batches = useMemo(
    () => groupRunsByBatchId({ runs: group.scenarioRuns }),
    [group.scenarioRuns],
  );

  return (
    <>
      {/* Group header - clickable to expand/collapse, sticky within scroll container */}
      <HStack
        as="button"
        width="full"
        paddingX={4}
        paddingY={3}
        gap={3}
        _hover={{ bg: "bg.subtle" }}
        cursor="pointer"
        onClick={onToggle}
        role="button"
        aria-expanded={isExpanded}
        aria-label={`${group.groupLabel} group`}
        position="sticky"
        top={0}
        zIndex={20}
        bg="rgba(255, 255, 255, 0.85)"
        _dark={{ bg: "rgba(26, 26, 26, 0.85)" }}
        backdropFilter="blur(12px)"
        borderBottom="1px solid"
        borderColor="border"
        data-testid="group-row-header"
      >
        {isExpanded ? (
          <ChevronDown size={14} />
        ) : (
          <ChevronRight size={14} />
        )}
        <Text fontSize="sm" fontWeight="bold" color="fg.default">
          {group.groupLabel}
        </Text>
        <Text fontSize="sm" color="fg.muted">
          &middot;
        </Text>
        <SummaryStatusIcon summary={summary} />
        <Text
          fontSize="sm"
          fontWeight="medium"
          color={summary.failedCount > 0 ? "red.600" : "green.600"}
        >
          {Math.round(summary.passRate)}%
        </Text>
        <Box flex={1} />
        <Text fontSize="xs" color="fg.muted">
          {runCount} {runCount === 1 ? "run" : "runs"}
        </Text>
      </HStack>

      {/* Expanded content - scenario runs sub-grouped by batch */}
      {isExpanded && (
        <>
          {batches.map((batch) => (
            <BatchSection
              key={batch.batchRunId}
              batch={batch}
              resolveTargetName={resolveTargetName}
              onScenarioRunClick={onScenarioRunClick}
              viewMode={viewMode}
            />
          ))}
          {group.scenarioRuns.length === 0 && (
            <Text fontSize="sm" color="fg.muted" paddingX={4} paddingY={3}>
              No scenario runs in this group.
            </Text>
          )}
        </>
      )}

      {/* Per-group footer stats */}
      <HStack
        paddingX={4}
        paddingY={2}
        borderBottom="1px solid"
        borderColor="border"
        bg="bg.subtle"
        fontSize="xs"
        color="fg.muted"
        justifyContent="space-between"
      >
        <Text>
          {summary.totalCount} {summary.totalCount === 1 ? "run" : "runs"}
        </Text>
        <HStack gap={3}>
          <Text color="green.600">{summary.passedCount} passed</Text>
          <Text color="red.600">{summary.failedCount} failed</Text>
          {summary.stalledCount > 0 && (
            <Text color="yellow.600">{summary.stalledCount} stalled</Text>
          )}
          {summary.cancelledCount > 0 && (
            <Text color="fg.muted">{summary.cancelledCount} cancelled</Text>
          )}
        </HStack>
      </HStack>
    </>
  );
}

/**
 * A lightweight batch section within a group, showing a sub-header
 * with timestamp and pass rate, followed by cards or rows.
 */
function BatchSection({
  batch,
  resolveTargetName,
  onScenarioRunClick,
  viewMode,
}: {
  batch: ReturnType<typeof groupRunsByBatchId>[number];
  resolveTargetName: (scenarioRun: ScenarioRunData) => string | null;
  onScenarioRunClick: (scenarioRun: ScenarioRunData) => void;
  viewMode: ViewMode;
}) {
  const batchSummary = useMemo(
    () => computeBatchRunSummary({ batchRun: batch }),
    [batch],
  );

  const iterationMap = useMemo(
    () => computeIterationMap({ scenarioRuns: batch.scenarioRuns }),
    [batch.scenarioRuns],
  );

  const timeAgo = formatTimeAgoCompact(batch.timestamp);

  return (
    <VStack align="stretch" gap={0}>
      {/* Batch sub-header (not sticky) */}
      <HStack
        paddingX={4}
        paddingY={2}
        gap={2}
        bg="bg.subtle"
        borderBottom="1px solid"
        borderColor="border.subtle"
        data-testid="batch-sub-header"
      >
        <Text fontSize="xs" color="fg.muted">
          {timeAgo}
        </Text>
        <Box flex={1} />
        <SummaryStatusIcon summary={batchSummary} />
        <Text
          fontSize="xs"
          fontWeight="medium"
          color={batchSummary.failedCount > 0 ? "red.600" : "green.600"}
        >
          {Math.round(batchSummary.passRate)}%
        </Text>
      </HStack>

      {/* Batch content */}
      {viewMode === "grid" ? (
        <Grid
          templateColumns="repeat(auto-fill, minmax(250px, 1fr))"
          gap={4}
          padding={4}
          position="relative"
          zIndex={0}
          data-testid="scenario-grid"
        >
          {batch.scenarioRuns.map((scenarioRun) => (
            <ScenarioGridCard
              key={scenarioRun.scenarioRunId}
              scenarioRun={scenarioRun}
              targetName={resolveTargetName(scenarioRun)}
              onClick={() => onScenarioRunClick(scenarioRun)}
              iteration={iterationMap.get(scenarioRun.scenarioRunId)}
            />
          ))}
        </Grid>
      ) : (
        <VStack align="stretch" gap={0} data-testid="scenario-list">
          {batch.scenarioRuns.map((scenarioRun) => (
            <ScenarioTargetRow
              key={scenarioRun.scenarioRunId}
              scenarioRun={scenarioRun}
              targetName={resolveTargetName(scenarioRun)}
              onClick={() => onScenarioRunClick(scenarioRun)}
              iteration={iterationMap.get(scenarioRun.scenarioRunId)}
            />
          ))}
        </VStack>
      )}
    </VStack>
  );
}
