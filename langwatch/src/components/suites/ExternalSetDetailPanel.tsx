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
  Button,
  EmptyState,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { FlaskConical, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Period } from "~/components/PeriodSelector";
import { ShadowDivider } from "~/components/ui/ShadowDivider";
import {
  explainHandledError,
  readHandledError,
  UNKNOWN_ERROR_PRESENTATION,
} from "~/features/errors";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useSimulationUpdateListener } from "~/hooks/useSimulationUpdateListener";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { api } from "~/utils/api";
import { GroupRow } from "./GroupRow";
import {
  RunHistoryFilters,
  type RunHistoryFilterValues,
} from "./RunHistoryFilters";
import { RunHistorySkeleton } from "./RunHistorySkeleton";
import { RunRow } from "./RunRow";
import {
  availableGroupByOptions,
  computeBatchRunSummary,
  computeGroupSummary,
  groupRunsByBatchId,
  groupRunsByScenarioId,
} from "./run-history-transforms";
import { useAutoExpansion } from "./useAutoExpansion";
import { useRunHistoryStore } from "./useRunHistoryStore";
import { useScrollToBatch } from "./useScrollToBatch";
import { useSuiteRunFreshness } from "./useSuiteRunFreshness";

type ExternalSetDetailPanelProps = {
  scenarioSetId: string;
  period: Period;
  highlightBatchId?: string | null;
};

/** Group-by options available for external sets (no target). */
const EXTERNAL_GROUP_BY_OPTIONS = availableGroupByOptions({
  viewContext: "external",
});

export function ExternalSetDetailPanel({
  scenarioSetId,
  period,
  highlightBatchId,
}: ExternalSetDetailPanelProps) {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const { highlightedBatchId } = useScrollToBatch({ highlightBatchId });
  const runListRef = useRef<HTMLDivElement>(null);

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

  // Live updates: SSE invalidates getSuiteRunData directly; its connection
  // state disables the fallback freshness polling below.
  const { isConnected: sseConnected } = useSimulationUpdateListener({
    projectId: project?.id ?? "",
    enabled: !!project?.id,
    debounceMs: 500,
    filter: { scenarioSetId },
  });

  const {
    data: runDataResult,
    isLoading,
    error,
    refetch,
  } = api.scenarios.getSuiteRunData.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioSetId,
      limit: 100,
      startDate: period.startDate.getTime(),
      endDate: period.endDate.getTime(),
    },
    {
      enabled: !!project,
      // No timer on the heavy query: SSE invalidations and the freshness
      // probe below drive refetches, so quiet sets never re-download runs.
      trpc: { context: { skipBatch: true } },
    },
  );

  const runData =
    runDataResult && "runs" in runDataResult ? runDataResult.runs : undefined;

  // The EmptyState below is this panel's whole error surface, so the copy is
  // read straight out of the registry rather than wrapped in a second Alert.
  const errorHandled = readHandledError(error);
  const errorExplanation = errorHandled
    ? explainHandledError(errorHandled)
    : UNKNOWN_ERROR_PRESENTATION;

  useSuiteRunFreshness({
    scenarioSetId,
    startDateMs: period.startDate.getTime(),
    endDateMs: period.endDate.getTime(),
    runs: runData ?? [],
    enabled: !!project,
    sseConnected,
  });

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

  // Clamp scenarioId filter to valid options for this external set
  useEffect(() => {
    if (!filters.scenarioId || scenarioOptions.length === 0) return;
    const validIds = new Set(scenarioOptions.map((s) => s.id));
    if (!validIds.has(filters.scenarioId)) {
      setFilters({ ...filters, scenarioId: "" });
    }
  }, [filters, scenarioOptions, setFilters]);

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

  const { expandedIds, toggleExpanded: handleToggle } = useAutoExpansion({
    panelKey: `external:${scenarioSetId}`,
    groupBy: effectiveGroupBy,
    batchRuns,
    groups,
  });

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
      <HStack paddingX={6} paddingY={4} justify="space-between">
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

      {/* Filter bar — fixed above the scrollable run list */}
      {!isLoading && !error && runData && runData.length > 0 && (
        <Box
          paddingX={6}
          paddingY={4}
          bg="bg"
          flexShrink={0}
          position="relative"
          _after={{
            content: '""',
            position: "absolute",
            bottom: "-5px",
            left: 0,
            right: 0,
            height: "5px",
            borderTop: "1px solid var(--chakra-colors-border-muted)",
            background:
              "linear-gradient(to bottom, color-mix(in srgb, var(--chakra-colors-border-muted) 40%, transparent), transparent)",
            pointerEvents: "none",
          }}
        >
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
      )}

      <ShadowDivider scrollRef={runListRef} />

      {/* Content — scrollable */}
      <VStack ref={runListRef} align="stretch" gap={0} flex={1} overflow="auto">
        {isLoading && <RunHistorySkeleton />}

        {error && (
          <EmptyState.Root paddingY={12}>
            <EmptyState.Content>
              <EmptyState.Indicator color="red.fg">
                <TriangleAlert size={28} />
              </EmptyState.Indicator>
              <EmptyState.Title>
                {errorExplanation.isRegistered
                  ? errorExplanation.title
                  : "Couldn't load run data"}
              </EmptyState.Title>
              <EmptyState.Description maxWidth="360px" textAlign="center">
                {errorExplanation.description}
              </EmptyState.Description>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refetch()}
              >
                <RefreshCw size={14} /> Try again
              </Button>
            </EmptyState.Content>
          </EmptyState.Root>
        )}

        {!isLoading && !error && runData && runData.length > 0 && (
          <>
            {/* Run rows */}
            {!hasData && hasActiveFilters ? (
              <Box paddingX={6} paddingY={8} textAlign="center">
                <Text color="fg.muted">
                  No runs match the selected filters.
                </Text>
              </Box>
            ) : (
              <>
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
                          isHighlighted={
                            highlightedBatchId === batchRun.batchRunId
                          }
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
              </>
            )}
          </>
        )}

        {!isLoading && !error && (!runData || runData.length === 0) && (
          <EmptyState.Root paddingY={12}>
            <EmptyState.Content>
              <EmptyState.Indicator>
                <FlaskConical size={28} />
              </EmptyState.Indicator>
              <EmptyState.Title>No runs yet</EmptyState.Title>
              <EmptyState.Description>
                No run data found for this set.
              </EmptyState.Description>
            </EmptyState.Content>
          </EmptyState.Root>
        )}
      </VStack>
    </VStack>
  );
}
