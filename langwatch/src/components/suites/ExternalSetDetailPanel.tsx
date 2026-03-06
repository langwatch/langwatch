/**
 * Read-only detail panel for external SDK/CI scenario sets.
 *
 * Displays the set name and batch run history with the shared filter bar
 * (scenario filter, pass/fail filter, group-by, list/grid toggle).
 *
 * External sets omit "Target" from group-by since they have no target resolution.
 */

import {
  Box,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { api } from "~/utils/api";
import {
  availableGroupByOptions,
  computeBatchRunSummary,
  computeGroupSummary,
  computeRunHistoryTotals,
  groupRunsByBatchId,
  groupRunsByScenarioId,
} from "./run-history-transforms";
import {
  RunHistoryFilters,
  type RunHistoryFilterValues,
} from "./RunHistoryFilters";
import { RunHistoryFooter } from "./RunHistoryFooter";
import { RunRow } from "./RunRow";
import { GroupRow } from "./GroupRow";
import { useRunHistoryStore } from "./useRunHistoryStore";

type ExternalSetDetailPanelProps = {
  scenarioSetId: string;
};

/** Group-by options available for external sets (no target). */
const EXTERNAL_GROUP_BY_OPTIONS = availableGroupByOptions({
  viewContext: "external",
});

export function ExternalSetDetailPanel({
  scenarioSetId,
}: ExternalSetDetailPanelProps) {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const hasAutoExpanded = useRef(false);

  // Use shared zustand store for groupBy, viewMode, and filters
  const groupBy = useRunHistoryStore((s) => s.groupBy);
  const viewMode = useRunHistoryStore((s) => s.viewMode);
  const filters = useRunHistoryStore((s) => s.filters);
  const setGroupBy = useRunHistoryStore((s) => s.setGroupBy);
  const setViewMode = useRunHistoryStore((s) => s.setViewMode);
  const setFilters = useRunHistoryStore((s) => s.setFilters);

  // Clamp groupBy to valid external options (e.g. if user navigated from suite with "target")
  const effectiveGroupBy = EXTERNAL_GROUP_BY_OPTIONS.includes(groupBy)
    ? groupBy
    : "none";

  // Reset expanded state when groupBy changes
  const prevGroupBy = useRef(effectiveGroupBy);
  useEffect(() => {
    if (prevGroupBy.current !== effectiveGroupBy) {
      setExpandedIds(new Set());
      hasAutoExpanded.current = false;
      prevGroupBy.current = effectiveGroupBy;
    }
  }, [effectiveGroupBy]);

  const {
    data: runData,
    isLoading,
    error,
  } = api.scenarios.getAllScenarioSetRunData.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioSetId,
    },
    {
      enabled: !!project,
      refetchInterval: 5000,
    },
  );

  // Fetch scenarios for filter options
  const { data: scenarios } = api.scenarios.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );

  // Build scenario options for filter dropdown
  const scenarioOptions = useMemo(() => {
    if (!scenarios || !runData) return [];
    // Only show scenarios that appear in the run data
    const scenarioIdsInData = new Set(runData.map((r) => r.scenarioId));
    return scenarios
      .filter((s) => scenarioIdsInData.has(s.id))
      .map((s) => ({ id: s.id, name: s.name }));
  }, [scenarios, runData]);

  // Apply filters to raw run data
  const filteredRuns = useMemo(() => {
    if (!runData) return [];

    let runs: ScenarioRunData[] = runData;

    if (filters.scenarioId) {
      runs = runs.filter((r) => r.scenarioId === filters.scenarioId);
    }

    if (filters.passFailStatus === "pass") {
      runs = runs.filter((r) => r.status === ScenarioRunStatus.SUCCESS);
    } else if (filters.passFailStatus === "fail") {
      runs = runs.filter(
        (r) =>
          r.status === ScenarioRunStatus.ERROR ||
          r.status === ScenarioRunStatus.FAILED,
      );
    } else if (filters.passFailStatus === "stalled") {
      runs = runs.filter((r) => r.status === ScenarioRunStatus.STALLED);
    }

    return runs;
  }, [runData, filters.scenarioId, filters.passFailStatus]);

  // Group filtered runs by batch (for groupBy "none")
  const batchRuns = useMemo(() => {
    return groupRunsByBatchId({ runs: filteredRuns });
  }, [filteredRuns]);

  // Group filtered runs by scenario (for groupBy "scenario")
  const groups = useMemo(() => {
    if (effectiveGroupBy === "none") return [];
    return groupRunsByScenarioId({ runs: filteredRuns });
  }, [effectiveGroupBy, filteredRuns]);

  // Auto-expand all rows when data first loads
  useEffect(() => {
    if (!hasAutoExpanded.current) {
      if (effectiveGroupBy === "none" && batchRuns.length > 0) {
        setExpandedIds(new Set(batchRuns.map((b) => b.batchRunId)));
        hasAutoExpanded.current = true;
      } else if (effectiveGroupBy !== "none" && groups.length > 0) {
        setExpandedIds(new Set(groups.map((g) => g.groupKey)));
        hasAutoExpanded.current = true;
      }
    }
  }, [batchRuns, groups, effectiveGroupBy]);

  const totals = useMemo(
    () => computeRunHistoryTotals({ runs: filteredRuns }),
    [filteredRuns],
  );

  const handleToggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleScenarioRunClick = useCallback(
    (run: ScenarioRunData) => {
      openDrawer("scenarioRunDetail", {
        urlParams: { scenarioRunId: run.scenarioRunId },
      });
    },
    [openDrawer],
  );

  // External sets have no target resolution
  const resolveTargetName = useCallback(() => null, []);

  const handleFiltersChange = useCallback(
    (newFilters: RunHistoryFilterValues) => {
      setFilters(newFilters);
    },
    [setFilters],
  );

  const hasData =
    effectiveGroupBy === "none" ? batchRuns.length > 0 : groups.length > 0;
  const hasActiveFilters = !!(filters.scenarioId || filters.passFailStatus);

  return (
    <VStack align="stretch" gap={0} height="100%">
      {/* Header */}
      <HStack
        paddingX={6}
        paddingY={4}
        borderBottom="1px solid"
        borderColor="border"
        justify="space-between"
      >
        <VStack align="start" gap={0}>
          <Text
            fontSize="xs"
            fontWeight="bold"
            color="fg.muted"
            letterSpacing="wider"
          >
            EXTERNAL SET
          </Text>
          <Text fontSize="lg" fontWeight="semibold">
            {scenarioSetId}
          </Text>
        </VStack>
      </HStack>

      {/* Content */}
      <Box flex={1} overflow="auto" paddingY={2}>
        {isLoading && (
          <VStack paddingY={8}>
            <Spinner />
            <Text fontSize="sm" color="fg.muted">
              Loading run data...
            </Text>
          </VStack>
        )}

        {error && (
          <VStack paddingY={8}>
            <Text color="red.500">Error loading run data</Text>
            <Text fontSize="sm" color="fg.muted">
              {error.message}
            </Text>
          </VStack>
        )}

        {!isLoading && !error && runData && runData.length > 0 && (
          <>
            {/* Filter bar with group-by selector and view toggle */}
            <Box paddingX={6} paddingY={4}>
              <RunHistoryFilters
                scenarioOptions={scenarioOptions}
                filters={filters}
                onFiltersChange={handleFiltersChange}
                groupBy={effectiveGroupBy}
                onGroupByChange={setGroupBy}
                groupByOptions={EXTERNAL_GROUP_BY_OPTIONS}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
              />
            </Box>

            {/* Run rows */}
            {!hasData && hasActiveFilters ? (
              <Box paddingX={6} paddingY={8} textAlign="center">
                <Text color="fg.muted">
                  No runs match the selected filters.
                </Text>
              </Box>
            ) : (
              <VStack align="stretch" gap={0} flex={1}>
                {effectiveGroupBy === "none"
                  ? batchRuns.map((batchRun) => {
                      const summary = computeBatchRunSummary({
                        batchRun,
                      });
                      return (
                        <RunRow
                          key={batchRun.batchRunId}
                          batchRun={batchRun}
                          summary={summary}
                          isExpanded={expandedIds.has(batchRun.batchRunId)}
                          onToggle={() => handleToggle(batchRun.batchRunId)}
                          resolveTargetName={resolveTargetName}
                          onScenarioRunClick={handleScenarioRunClick}
                          viewMode={viewMode}
                        />
                      );
                    })
                  : groups.map((group) => {
                      const summary = computeGroupSummary({ group });
                      return (
                        <GroupRow
                          key={group.groupKey}
                          group={group}
                          summary={summary}
                          isExpanded={expandedIds.has(group.groupKey)}
                          onToggle={() => handleToggle(group.groupKey)}
                          onScenarioRunClick={handleScenarioRunClick}
                          resolveTargetName={resolveTargetName}
                          viewMode={viewMode}
                        />
                      );
                    })}
              </VStack>
            )}

            {/* Footer */}
            <RunHistoryFooter totals={totals} />
          </>
        )}

        {!isLoading && !error && (!runData || runData.length === 0) && (
          <VStack paddingY={8}>
            <Text fontSize="sm" color="fg.muted">
              No run data found for this set.
            </Text>
          </VStack>
        )}
      </Box>
    </VStack>
  );
}
