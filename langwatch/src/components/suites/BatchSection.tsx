/**
 * A lightweight batch section within a group, showing a sub-header
 * with timestamp and pass rate, followed by cards or rows.
 */

import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";
import type { BatchRun, BatchRunSummary } from "./run-history-transforms";
import {
  computeBatchRunSummary,
  computeIterationMap,
} from "./run-history-transforms";
import { ScenarioRunContent } from "./ScenarioRunContent";
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
      {/* Batch sub-header — plain text, no background */}
      <HStack
        paddingX={4}
        paddingY={2}
        gap={2}
        data-testid="batch-sub-header"
      >
        <Text fontSize="xs" color="fg.muted">
          {timeAgo}
        </Text>
        <Box flex={1} />
        <BatchStatusCounts summary={batchSummary} />
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

/** Simple dot + count pairs for batch sub-headers, no badges/labels. */
function BatchStatusCounts({ summary }: { summary: BatchRunSummary }) {
  const items: { count: number; color: string; label: string }[] = [];
  if (summary.passedCount > 0) items.push({ count: summary.passedCount, color: "green.500", label: "passed" });
  if (summary.failedCount > 0) items.push({ count: summary.failedCount, color: "red.500", label: "failed" });
  if (summary.stalledCount > 0) items.push({ count: summary.stalledCount, color: "yellow.500", label: "stalled" });
  if (summary.cancelledCount > 0) items.push({ count: summary.cancelledCount, color: "fg.muted", label: "cancelled" });
  if (summary.inProgressCount > 0) items.push({ count: summary.inProgressCount, color: "orange.500", label: "running" });
  if (summary.queuedCount > 0) items.push({ count: summary.queuedCount, color: "blue.500", label: "queued" });

  if (items.length === 0) return null;

  return (
    <HStack gap={2}>
      {items.map((item) => (
        <HStack key={item.label} gap={1}>
          <Box width="6px" height="6px" borderRadius="full" bg={item.color} flexShrink={0} />
          <Text fontSize="xs" color="fg.muted">
            {item.count} {item.label}
          </Text>
        </HStack>
      ))}
    </HStack>
  );
}
