/**
 * Collapsible row for a grouped set of scenario runs.
 *
 * Used when group-by is set to "scenario" or "target".
 * Header: [chevron] [group_name (bold)] [status_icon] [pass_rate] ... [N runs]
 * Footer: [N passed] [N failed]
 * Expanded: ScenarioTargetRow (list) or ScenarioGridCard (grid) for each run.
 */

import { Box, Grid, HStack, Text, VStack } from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { SummaryStatusIcon } from "./SummaryStatusIcon";
import type { RunGroup, RunGroupSummary } from "./run-history-transforms";
import { ScenarioTargetRow } from "./ScenarioTargetRow";
import { ScenarioGridCard } from "./ScenarioGridCard";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import type { ViewMode } from "./useRunHistoryStore";

type GroupRowProps = {
  group: RunGroup;
  summary: RunGroupSummary;
  isExpanded: boolean;
  onToggle: () => void;
  onScenarioRunClick: (scenarioRun: ScenarioRunData) => void;
  targetName?: string | null;
  viewMode?: ViewMode;
};

export function GroupRow({
  group,
  summary,
  isExpanded,
  onToggle,
  onScenarioRunClick,
  targetName,
  viewMode = "grid",
}: GroupRowProps) {
  const runCount = group.scenarioRuns.length;

  return (
    <Box
      border="1px solid"
      borderColor="border"
      borderRadius="0"
      overflow="visible"
    >
      {/* Group header - clickable to expand/collapse, sticky */}
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
        zIndex={10}
        bg="bg"
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

      {/* Expanded content - individual scenario runs */}
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
              {group.scenarioRuns.map((scenarioRun) => (
                <ScenarioGridCard
                  key={scenarioRun.scenarioRunId}
                  scenarioRun={scenarioRun}
                  targetName={targetName ?? null}
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
              {group.scenarioRuns.map((scenarioRun) => (
                <ScenarioTargetRow
                  key={scenarioRun.scenarioRunId}
                  scenarioRun={scenarioRun}
                  targetName={targetName ?? null}
                  onClick={() => onScenarioRunClick(scenarioRun)}
                />
              ))}
            </VStack>
          )}
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
