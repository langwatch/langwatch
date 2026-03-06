/**
 * Collapsible row for a single batch run in the run history list.
 *
 * Header: [chevron] [suiteName] . [scenarioNames] . [timeAgo] . [spacer] . [statusIcon] [passRate%]
 * Expanded: shows ScenarioTargetRow (list) or ScenarioGridCard (grid) for each scenario run.
 *
 * The header is rendered as a direct child of the scroll container (no wrapper Box)
 * so that `position: sticky` works correctly within the scrollport.
 */

import { Box, HStack, Text } from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { SummaryStatusIcon } from "./SummaryStatusIcon";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import type { BatchRun, BatchRunSummary } from "./run-history-transforms";
import { computeIterationMap, getScenarioDisplayNames } from "./run-history-transforms";
import { ScenarioRunContent } from "./ScenarioRunContent";
import { RunSummaryFooter } from "./RunSummaryFooter";
import { formatSummaryStatusLabel } from "./format-run-status-label";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import type { ViewMode } from "./useRunHistoryStore";

type RunRowProps = {
  batchRun: BatchRun;
  summary: BatchRunSummary;
  isExpanded: boolean;
  onToggle: () => void;
  resolveTargetName: (scenarioRun: ScenarioRunData) => string | null;
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
  resolveTargetName,
  onScenarioRunClick,
  expectedJobCount,
  suiteName,
  viewMode = "grid",
}: RunRowProps) {
  const timeAgo = formatTimeAgoCompact(batchRun.timestamp);
  const scenarioNames = suiteName
    ? getScenarioDisplayNames({ scenarioRuns: batchRun.scenarioRuns })
    : "";

  const iterationMap = useMemo(
    () => computeIterationMap({ scenarioRuns: batchRun.scenarioRuns }),
    [batchRun.scenarioRuns],
  );

  return (
    <>
      {/* Run header - clickable to expand/collapse, sticky within scroll container */}
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
        zIndex={20}
        bg="bg.panel/85"
        backdropFilter="blur(12px)"
        borderBottom="1px solid"
        borderColor="border"
        data-testid="run-row-header"
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
          {formatSummaryStatusLabel(summary)}
        </Text>
      </HStack>

      {/* Expanded content - scenario results in list or grid */}
      {isExpanded && (
        <>
          <ScenarioRunContent
            scenarioRuns={batchRun.scenarioRuns}
            viewMode={viewMode}
            resolveTargetName={resolveTargetName}
            onScenarioRunClick={onScenarioRunClick}
            iterationMap={iterationMap}
          />
          {batchRun.scenarioRuns.length === 0 && (
            <Text fontSize="sm" color="fg.muted" paddingX={4} paddingY={3}>
              No scenario runs in this batch.
            </Text>
          )}
        </>
      )}

      <RunSummaryFooter summary={summary} />
    </>
  );
}
