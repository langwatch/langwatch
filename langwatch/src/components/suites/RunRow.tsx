/**
 * Collapsible row for a single batch run in the run history list.
 *
 * Header: [chevron] [suiteName] . [scenarioNames] . [timeAgo] . [spacer] . [statusIcon] [passRate%]
 * Expanded: shows ScenarioTargetRow (list) or ScenarioGridCard (grid) for each scenario run.
 */

import { Box, Grid, HStack, Text, VStack } from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { SummaryStatusIcon } from "./SummaryStatusIcon";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import type { BatchRun, BatchRunSummary } from "./run-history-transforms";
import { getScenarioDisplayNames } from "./run-history-transforms";
import { ScenarioTargetRow } from "./ScenarioTargetRow";
import { ScenarioGridCard } from "./ScenarioGridCard";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import type { ViewMode } from "./useRunHistoryStore";

type RunRowProps = {
  batchRun: BatchRun;
  summary: BatchRunSummary;
  isExpanded: boolean;
  onToggle: () => void;
  targetName: string | null;
  onScenarioRunClick: (scenarioRun: ScenarioRunData) => void;
  expectedJobCount?: number;
  suiteName?: string;
  viewMode?: ViewMode;
};

export function RunRow({
  batchRun,
  summary,
  isExpanded,
  onToggle,
  targetName,
  onScenarioRunClick,
  expectedJobCount,
  suiteName,
  viewMode = "grid",
}: RunRowProps) {
  const timeAgo = formatTimeAgoCompact(batchRun.timestamp);
  const scenarioNames = suiteName
    ? getScenarioDisplayNames({ scenarioRuns: batchRun.scenarioRuns })
    : "";

  return (
    <Box
      border="1px solid"
      borderColor="border"
      borderRadius="0"
      overflow="visible"
    >
      {/* Run header - clickable to expand/collapse, sticky */}
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
        position="sticky"
        top={0}
        zIndex={10}
        bg="bg"
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
        {scenarioNames && (
          <>
            <Text fontSize="sm" color="fg.muted" truncate minWidth={0}>
              {scenarioNames}
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
        <SummaryStatusIcon summary={summary} />
        <Text
          fontSize="sm"
          fontWeight="medium"
          color={summary.failedCount > 0 ? "red.600" : "green.600"}
        >
          {Math.round(summary.passRate)}%
        </Text>
      </HStack>

      {/* Expanded content - scenario results in list or grid */}
      {isExpanded && (
        <>
          {viewMode === "grid" ? (
            <Grid
              templateColumns="repeat(auto-fill, minmax(250px, 1fr))"
              gap={4}
              padding={4}
              borderTop="1px solid"
              borderColor="border"
              data-testid="scenario-grid"
            >
              {batchRun.scenarioRuns.map((scenarioRun) => (
                <ScenarioGridCard
                  key={scenarioRun.scenarioRunId}
                  scenarioRun={scenarioRun}
                  targetName={targetName}
                  onClick={() => onScenarioRunClick(scenarioRun)}
                />
              ))}
            </Grid>
          ) : (
            <VStack
              align="stretch"
              gap={0}
              borderTop="1px solid"
              borderColor="border"
              data-testid="scenario-list"
            >
              {batchRun.scenarioRuns.map((scenarioRun) => (
                <ScenarioTargetRow
                  key={scenarioRun.scenarioRunId}
                  scenarioRun={scenarioRun}
                  targetName={targetName}
                  onClick={() => onScenarioRunClick(scenarioRun)}
                />
              ))}
            </VStack>
          )}
          {batchRun.scenarioRuns.length === 0 && (
            <Text fontSize="sm" color="fg.muted" paddingX={4} paddingY={3}>
              No scenario runs in this batch.
            </Text>
          )}
        </>
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
          {summary.stalledCount > 0 && (
            <Text color="yellow.600">{summary.stalledCount} stalled</Text>
          )}
          {summary.cancelledCount > 0 && (
            <Text color="fg.muted">{summary.cancelledCount} cancelled</Text>
          )}
        </HStack>
      </HStack>
    </Box>
  );
}
