/**
 * Collapsible row for a single batch run in the run history list.
 *
 * Header: [chevron] [relative_time] . [status_icon] [pass_rate] [trigger_type]
 * Expanded: shows ScenarioTargetRow for each scenario run in the batch.
 */

import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { CheckCircle, ChevronDown, ChevronRight, XCircle, Loader } from "lucide-react";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import type { BatchRun, BatchRunSummary } from "./run-history-transforms";
import { ScenarioTargetRow } from "./ScenarioTargetRow";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";

type RunRowProps = {
  batchRun: BatchRun;
  summary: BatchRunSummary;
  isExpanded: boolean;
  onToggle: () => void;
  targetName: string | null;
  onScenarioRunClick: (scenarioRun: ScenarioRunData) => void;
  expectedJobCount?: number;
  suiteName?: string; // displayed in All Runs view
};

function OverallStatusIcon({ summary }: { summary: BatchRunSummary }) {
  if (summary.inProgressCount > 0) {
    return <Loader size={14} color="var(--chakra-colors-orange-500)" style={{ animation: "spin 2s linear infinite" }} />;
  }
  if (summary.failedCount > 0) {
    return <XCircle size={14} color="var(--chakra-colors-red-500)" />;
  }
  return <CheckCircle size={14} color="var(--chakra-colors-green-500)" />;
}

export function RunRow({
  batchRun,
  summary,
  isExpanded,
  onToggle,
  targetName,
  onScenarioRunClick,
  expectedJobCount,
  suiteName,
}: RunRowProps) {
  const timeAgo = formatTimeAgoCompact(batchRun.timestamp);

  return (
    <Box
      border="1px solid"
      borderColor="border"
      borderRadius="md"
      overflow="hidden"
    >
      {/* Run header - clickable to expand/collapse */}
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
        aria-label={`Run from ${timeAgo ?? "unknown time"}`}
      >
        {isExpanded ? (
          <ChevronDown size={14} />
        ) : (
          <ChevronRight size={14} />
        )}
        {suiteName && (
          <>
            <Text fontSize="sm" fontWeight="medium" color="fg.default">
              {suiteName}
            </Text>
            <Text fontSize="sm" color="fg.muted">
              &middot;
            </Text>
          </>
        )}
        <Text fontSize="xs" color="fg.subtle">
          {timeAgo}
        </Text>
        {expectedJobCount != null && summary.totalCount < expectedJobCount && (
          <Text fontSize="xs" color="fg.muted">
            {summary.totalCount} of {expectedJobCount}
          </Text>
        )}
        <Box flex={1} />
        <OverallStatusIcon summary={summary} />
        <Text
          fontSize="sm"
          fontWeight="medium"
          color={summary.failedCount > 0 ? "red.600" : "green.600"}
        >
          {Math.round(summary.passRate)}%
        </Text>
      </HStack>

      {/* Expanded content - scenario x target rows */}
      {isExpanded && (
        <VStack align="stretch" gap={0} borderTop="1px solid" borderColor="border">
          {batchRun.scenarioRuns.map((scenarioRun) => (
            <ScenarioTargetRow
              key={scenarioRun.scenarioRunId}
              scenarioRun={scenarioRun}
              targetName={targetName}
              onClick={() => onScenarioRunClick(scenarioRun)}
            />
          ))}
          {batchRun.scenarioRuns.length === 0 && (
            <Text fontSize="sm" color="fg.muted" paddingX={4} paddingY={3}>
              No scenario runs in this batch.
            </Text>
          )}
        </VStack>
      )}

      {/* Per-batch footer stats */}
      <HStack
        paddingX={4}
        paddingY={2}
        borderTop="1px solid"
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
        </HStack>
      </HStack>
    </Box>
  );
}
