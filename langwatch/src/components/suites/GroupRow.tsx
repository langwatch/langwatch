/**
 * Collapsible row for a grouped set of scenario runs.
 *
 * Used when group-by is set to "scenario" or "target".
 * Header: [chevron] [group_name (bold)] [counts (word labels)] ... [N runs]
 * Expanded: sub-grouped by batch, each with a lightweight header showing
 * timestamp and pass rate, then ScenarioTargetRow (list) or ScenarioGridCard (grid).
 *
 * The header is rendered as a direct child of the scroll container (no wrapper Box)
 * so that `position: sticky` works correctly within the scrollport.
 */

import { Box, HStack, Text } from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import type { RunGroup, RunGroupSummary } from "./run-history-transforms";
import { groupRunsByBatchId } from "./run-history-transforms";
import { BatchSection } from "./BatchSection";
import { RunMetricsSummary } from "./RunMetricsSummary";
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
  onCancelRun?: (scenarioRun: ScenarioRunData) => void;
  cancellingJobId?: string | null;
};

export function GroupRow({
  group,
  summary,
  isExpanded,
  onToggle,
  onScenarioRunClick,
  resolveTargetName,
  viewMode = "grid",
  onCancelRun,
  cancellingJobId,
}: GroupRowProps) {
  const runCount = group.scenarioRuns.length;

  const batches = useMemo(
    () => groupRunsByBatchId({ runs: group.scenarioRuns }),
    [group.scenarioRuns],
  );

  return (
    <Box>
      {/* Group header — same card style as RunRow */}
      <Box padding={2} paddingBottom={0} width="full" position="sticky" top={0} zIndex={20}>
        <HStack
          as="button"
          width="full"
          paddingX={4}
          paddingY={3}
          gap={3}
          flexWrap="nowrap"
          cursor="pointer"
          onClick={onToggle}
          className="group"
          aria-expanded={isExpanded}
          aria-label={`${group.groupLabel} group`}
          bg="bg.subtle/50"
          backdropFilter="blur(4px)"
          data-testid="group-row-header"
          borderRadius="lg"
          boxShadow="xs"
        >
          {isExpanded ? (
            <ChevronDown size={14} style={{ flexShrink: 0 }} />
          ) : (
            <ChevronRight size={14} style={{ flexShrink: 0 }} />
          )}
          <Text fontSize="sm" fontWeight="medium" color="fg.default" truncate minWidth={0} flexShrink={1}>
            {group.groupLabel}
          </Text>
          <Text fontSize="sm" color="fg.muted" flexShrink={0}>
            &middot;
          </Text>
          <Text fontSize="xs" color="fg.muted" flexShrink={0}>
            {runCount} {runCount === 1 ? "run" : "runs"}
          </Text>
          <Box flex={1} />
          <Box flexShrink={0}>
            <RunMetricsSummary summary={summary} />
          </Box>
        </HStack>
      </Box>

      {/* Expanded content - scenario runs sub-grouped by batch */}
      <Box padding={2}>
        {isExpanded && (
          <>
            {batches.map((batch) => (
              <BatchSection
                key={batch.batchRunId}
                batch={batch}
                resolveTargetName={resolveTargetName}
                onScenarioRunClick={onScenarioRunClick}
                viewMode={viewMode}
                onCancelRun={onCancelRun}
                cancellingJobId={cancellingJobId}
              />
            ))}
            {group.scenarioRuns.length === 0 && (
              <Text fontSize="sm" color="fg.muted" paddingX={4} paddingY={3}>
                No scenario runs in this group.
              </Text>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}
