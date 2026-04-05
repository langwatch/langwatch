/**
 * A lightweight batch section within a group, showing a sub-header
 * with timestamp and pass rate, followed by cards or rows.
 */

import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";
import { SummaryStatusIcon } from "./SummaryStatusIcon";
import type { BatchRun } from "./run-history-transforms";
import {
  computeBatchRunSummary,
  computeIterationMap,
} from "./run-history-transforms";
import { ScenarioRunContent } from "./ScenarioRunContent";
import { RunSummaryCounts } from "./RunSummaryCounts";
import { useNow } from "~/hooks/useNow";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import type { ViewMode } from "./useRunHistoryStore";

type BatchSectionProps = {
  batch: BatchRun;
  resolveTargetName: (scenarioRun: ScenarioRunData) => string | null;
  onScenarioRunClick: (scenarioRun: ScenarioRunData) => void;
  viewMode: ViewMode;
  onCancelRun?: (scenarioRun: ScenarioRunData) => void;
  cancellingJobId?: string | null;
};

export function BatchSection({
  batch,
  resolveTargetName,
  onScenarioRunClick,
  viewMode,
  onCancelRun,
  cancellingJobId,
}: BatchSectionProps) {
  const batchSummary = useMemo(
    () => computeBatchRunSummary({ batchRun: batch }),
    [batch],
  );

  const iterationMap = useMemo(
    () => computeIterationMap({ scenarioRuns: batch.scenarioRuns }),
    [batch.scenarioRuns],
  );

  const now = useNow();
  const timeAgo = formatTimeAgoCompact(batch.timestamp, now);

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
        <RunSummaryCounts summary={batchSummary} />
      </HStack>

      <ScenarioRunContent
        scenarioRuns={batch.scenarioRuns}
        viewMode={viewMode}
        resolveTargetName={resolveTargetName}
        onScenarioRunClick={onScenarioRunClick}
        iterationMap={iterationMap}
        onCancelRun={onCancelRun}
        cancellingJobId={cancellingJobId}
      />
    </VStack>
  );
}
