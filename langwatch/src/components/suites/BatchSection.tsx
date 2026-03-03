/**
 * A lightweight batch section within a group, showing a sub-header
 * with timestamp and pass rate, followed by cards or rows.
 */

import { Box, Grid, HStack, Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";
import { SummaryStatusIcon } from "./SummaryStatusIcon";
import type { BatchRun } from "./run-history-transforms";
import {
  computeBatchRunSummary,
  computeIterationMap,
} from "./run-history-transforms";
import { ScenarioTargetRow } from "./ScenarioTargetRow";
import { ScenarioGridCard } from "./ScenarioGridCard";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import type { ViewMode } from "./useRunHistoryStore";

type BatchSectionProps = {
  batch: BatchRun;
  resolveTargetName: (scenarioRun: ScenarioRunData) => string | null;
  onScenarioRunClick: (scenarioRun: ScenarioRunData) => void;
  viewMode: ViewMode;
};

export function BatchSection({
  batch,
  resolveTargetName,
  onScenarioRunClick,
  viewMode,
}: BatchSectionProps) {
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
