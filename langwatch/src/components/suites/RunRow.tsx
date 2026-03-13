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
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import type { BatchRun, BatchRunSummary } from "./run-history-transforms";
import { computeIterationMap, getScenarioDisplayNames } from "./run-history-transforms";
import { ScenarioRunContent } from "./ScenarioRunContent";
import { RunSummaryCounts } from "./RunSummaryCounts";
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
        flexWrap="nowrap"
        _hover={{ bg: "bg.subtle" }}
        cursor="pointer"
        onClick={onToggle}
        role="button"
        aria-expanded={isExpanded}
        aria-label={`Run from ${timeAgo ?? "unknown time"}`}
        position="sticky"
        top={0}
        zIndex={20}
        bg="bg.muted"
        borderBottom="1px solid"
        borderColor="border"
        data-testid="run-row-header"
      >
        {isExpanded ? (
          <ChevronDown size={14} style={{ flexShrink: 0 }} />
        ) : (
          <ChevronRight size={14} style={{ flexShrink: 0 }} />
        )}
        {suiteName && (
          <>
            <Text fontSize="sm" fontWeight="medium" color="fg.default" flexShrink={0}>
              {suiteName}
            </Text>
            <Text fontSize="sm" color="fg.muted" flexShrink={0}>
              &middot;
            </Text>
          </>
        )}
        {scenarioNames && (
          <>
            <Text fontSize="sm" color="fg.muted" truncate minWidth={0} flexShrink={1}>
              {scenarioNames}
            </Text>
            <Text fontSize="sm" color="fg.muted" flexShrink={0}>
              &middot;
            </Text>
          </>
        )}
        <Text fontSize="xs" color="fg.subtle" flexShrink={0}>
          {timeAgo}
        </Text>
        {expectedJobCount != null && summary.totalCount < expectedJobCount && (
          <Text fontSize="xs" color="fg.muted" flexShrink={0}>
            {summary.totalCount} of {expectedJobCount}
          </Text>
        )}
        <Box flex={1} />
        <RunSummaryCounts summary={summary} />
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

    </>
  );
}
