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

import { Box, HStack, Text } from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { SummaryStatusIcon } from "./SummaryStatusIcon";
import type { RunGroup, RunGroupSummary } from "./run-history-transforms";
import { groupRunsByBatchId } from "./run-history-transforms";
import { BatchSection } from "./BatchSection";
import { RunSummaryFooter } from "./RunSummaryFooter";
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
        bg="bg.panel/85"
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

      <RunSummaryFooter summary={summary} />
    </>
  );
}
