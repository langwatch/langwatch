/**
 * Unified run history panel for both single-suite and cross-suite views.
 *
 * When scenarioSetId is provided, filters to that suite.
 * When absent, shows runs across all suites.
 * Both paths use cursor-based pagination with Load More.
 */

import {
  Box,
  Button,
  EmptyState,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { FlaskConical, RefreshCw, TriangleAlert } from "lucide-react";
import { toaster } from "~/components/ui/toaster";
import { useRouter } from "~/utils/compat/next-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { useTargetNameMap } from "~/hooks/useTargetNameMap";
import { useDrawer } from "~/hooks/useDrawer";
import { useSimulationUpdateListener } from "~/hooks/useSimulationUpdateListener";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { Period } from "~/components/PeriodSelector";
import {
  RunHistoryFilters,
  type RunHistoryFilterValues,
} from "./RunHistoryFilters";
import { RunRow } from "./RunRow";
import { GroupRow } from "./GroupRow";
import { RunHistorySkeleton } from "./RunHistorySkeleton";
import { ShadowDivider } from "~/components/ui/ShadowDivider";
import { RunSummaryCounts } from "./RunSummaryCounts";
import { useRunHistoryStore } from "./useRunHistoryStore";
import { useRunHistoryPagination } from "./useRunHistoryPagination";
import { useAutoExpansion } from "./useAutoExpansion";
import { useCancelScenarioRun } from "./useCancelScenarioRun";
import {
  computeBatchRunSummary,
  computeGroupSummary,
  computeRunHistoryTotals,
  resolveOriginLabel,
  groupRunsByBatchId,
  groupRunsByScenarioId,
  groupRunsByTarget,
} from "./run-history-transforms";
import { isOnPlatformSet } from "~/server/scenarios/internal-set-id";
import { isSuiteSetId } from "~/server/suites/suite-set-id";
import { useScrollToBatch } from "./useScrollToBatch";

export type RunHistoryStats = {
  runCount: number;
  passRate: number;
  lastActivityTimestamp: number | null;
};

type RunHistoryPanelProps = {
  /** When provided, filters to a single suite. When absent, shows all suites. */
  scenarioSetId?: string;
  period: Period;
  /** Callback for suite detail header stats */
  onStatsReady?: (stats: RunHistoryStats) => void;
  /** For "N of M" display in suite view */
  expectedJobCount?: number;
  /** For All Runs view to show suite names on rows */
  suiteNameMap?: Map<string, string>;
  /** When set, shows an initializing placeholder until this batch appears in the data */
  pendingBatchRunId?: string | null;
  /** When set, the matching batch row is scrolled into view and highlighted. */
  highlightBatchId?: string | null;
};

export function RunHistoryPanel({
  scenarioSetId,
  period,
  onStatsReady,
  expectedJobCount,
  suiteNameMap,
  pendingBatchRunId,
  highlightBatchId,
}: RunHistoryPanelProps) {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();

  // Use zustand store for filters, groupBy, and viewMode with URL sync
  const groupBy = useRunHistoryStore((s) => s.groupBy);
  const viewMode = useRunHistoryStore((s) => s.viewMode);
  const filters = useRunHistoryStore((s) => s.filters);
  const setGroupBy = useRunHistoryStore((s) => s.setGroupBy);
  const setViewMode = useRunHistoryStore((s) => s.setViewMode);
  const setFilters = useRunHistoryStore((s) => s.setFilters);
  const syncToUrl = useRunHistoryStore((s) => s.syncToUrl);
  const hydrateFromUrl = useRunHistoryStore((s) => s.hydrateFromUrl);

  const runListRef = useRef<HTMLDivElement>(null);

  // Hydrate from URL on mount
  const hasHydrated = useRef(false);
  useEffect(() => {
    if (!hasHydrated.current && router.isReady) {
      hydrateFromUrl(router.query);
      hasHydrated.current = true;
    }
  }, [router.isReady, router.query, hydrateFromUrl]);

  // Sync to URL on state changes (after initial hydration)
  const prevGroupBy = useRef(groupBy);
  const prevFilters = useRef(filters);
  useEffect(() => {
    if (!hasHydrated.current) return;
    if (prevGroupBy.current !== groupBy || prevFilters.current !== filters) {
      prevGroupBy.current = groupBy;
      prevFilters.current = filters;
      syncToUrl(router);
    }
  }, [groupBy, filters, syncToUrl, router]);

  // Live updates: SSE invalidates getSuiteRunData directly (no refetch
  // callback needed). Its connection state disables fallback polling.
  const { isConnected: sseConnected } = useSimulationUpdateListener({
    projectId: project?.id ?? "",
    enabled: !!project?.id,
    debounceMs: 500,
    filter: scenarioSetId ? { scenarioSetId } : undefined,
  });

  // Pagination
  const startDateMs = period.startDate.getTime();
  const {
    allRuns,
    allScenarioSetIds,
    hasMore,
    loadMore,
    isLoading,
    error,
    refetch,
  } = useRunHistoryPagination({ scenarioSetId, startDateMs, sseConnected });

  // Fetch scenarios for filter options
  const { data: scenarios } = api.scenarios.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );

  const targetNameMap = useTargetNameMap();

  const resolveTargetName = useCallback(
    (scenarioRun: ScenarioRunData): string | null => {
      const refId = scenarioRun.metadata?.langwatch?.targetReferenceId;
      if (!refId) return null;
      return targetNameMap.get(refId) ?? refId;
    },
    [targetNameMap],
  );

  // Build scenario options for filter dropdown
  const scenarioOptions = useMemo(() => {
    if (!scenarios) return [];
    return scenarios.map((s) => ({ id: s.id, name: s.name }));
  }, [scenarios]);

  // Track the specific job ID currently being cancelled for per-button loading state
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null);

  const { cancelJob, cancelBatchRun, isCancellingBatch } = useCancelScenarioRun({
    onCancelJobSuccess: () => {
      setCancellingJobId(null);
      void refetch();
      toaster.create({
        title: "Cancellation requested",
        type: "info",
      });
    },
    onCancelJobError: (error) => {
      setCancellingJobId(null);
      void refetch();
      toaster.create({
        title: "Failed to cancel job",
        description: error.message,
        type: "error",
      });
    },
    onCancelBatchSuccess: () => {
      void refetch();
      toaster.create({ title: "Jobs cancelled", type: "success" });
    },
    onCancelBatchError: (error) => {
      toaster.create({
        title: "Failed to cancel jobs",
        description: error.message,
        type: "error",
      });
    },
  });

  // Apply filters to raw runs
  const filteredRuns = useMemo(() => {
    if (allRuns.length === 0) return [];

    let runs = allRuns;

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
  }, [allRuns, filters]);

  // Group filtered runs by batch
  const batchRuns = useMemo(
    () =>
      groupRunsByBatchId({
        runs: filteredRuns,
        scenarioSetIds: allScenarioSetIds,
      }),
    [filteredRuns, allScenarioSetIds],
  );

  // Group filtered runs by scenario or target
  const groups = useMemo(() => {
    if (groupBy === "none") return [];
    return groupBy === "scenario"
      ? groupRunsByScenarioId({ runs: filteredRuns })
      : groupRunsByTarget({ runs: filteredRuns, targetNameMap });
  }, [groupBy, filteredRuns, targetNameMap]);

  // Auto-expansion
  const { expandedIds, toggleExpanded } = useAutoExpansion({
    panelKey: scenarioSetId ?? "all-runs",
    groupBy,
    batchRuns,
    groups,
  });

  const totals = useMemo(
    () => computeRunHistoryTotals({ runs: filteredRuns }),
    [filteredRuns],
  );

  const lastActivityTimestamp =
    groupBy === "none"
      ? (batchRuns[0]?.timestamp ?? null)
      : (groups[0]?.timestamp ?? null);

  // Notify parent when stats are ready
  useEffect(() => {
    if (!onStatsReady) return;
    const finishedCount = totals.passedCount + totals.failedCount;
    const passRate =
      finishedCount > 0 ? (totals.passedCount / finishedCount) * 100 : 0;

    onStatsReady({
      runCount: totals.runCount,
      passRate,
      lastActivityTimestamp,
    });
  }, [totals, lastActivityTimestamp, onStatsReady]);

  // Scroll-to-batch highlighting
  const { highlightedBatchId } = useScrollToBatch({ highlightBatchId });

  const isPlatformManaged = (setId: string | undefined) =>
    !!setId && (isOnPlatformSet(setId) || isSuiteSetId(setId));

  const createCancelRunHandler = useCallback(
    (setId: string) => (scenarioRun: ScenarioRunData) => {
      if (!project?.id) return;
      setCancellingJobId(scenarioRun.scenarioRunId);
      cancelJob({
        projectId: project.id,
        scenarioSetId: setId,
        batchRunId: scenarioRun.batchRunId,
        scenarioRunId: scenarioRun.scenarioRunId,
        scenarioId: scenarioRun.scenarioId,
      });
    },
    [project?.id, cancelJob],
  );

  const handleCancelAll = useCallback(
    (batchRunId: string, batchRunScenarioSetId: string) => {
      if (!project?.id) return;
      cancelBatchRun({ projectId: project.id, scenarioSetId: batchRunScenarioSetId, batchRunId });
    },
    [project?.id, cancelBatchRun],
  );
  const { openDrawer } = useDrawer();

  const handleScenarioRunClick = useCallback(
    (scenarioRun: ScenarioRunData) => {
      openDrawer("scenarioRunDetail", {
        urlParams: { scenarioRunId: scenarioRun.scenarioRunId },
      });
    },
    [openDrawer],
  );

  const handleFiltersChange = useCallback(
    (newFilters: RunHistoryFilterValues) => {
      setFilters(newFilters);
    },
    [setFilters],
  );

  // Show initializing placeholder until the pending batch appears in the data.
  const showInitPlaceholder = useMemo(() => {
    if (!pendingBatchRunId) return false;
    return !batchRuns.some((b) => b.batchRunId === pendingBatchRunId);
  }, [pendingBatchRunId, batchRuns]);

  // --- Render ---

  if (error) {
    return (
      <EmptyState.Root paddingY={12}>
        <EmptyState.Content>
          <EmptyState.Indicator color="red.fg">
            <TriangleAlert size={28} />
          </EmptyState.Indicator>
          <EmptyState.Title>Couldn&apos;t load runs</EmptyState.Title>
          <EmptyState.Description maxWidth="360px" textAlign="center">
            {error.message}
          </EmptyState.Description>
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            <RefreshCw size={14} /> Try again
          </Button>
        </EmptyState.Content>
      </EmptyState.Root>
    );
  }

  const isSingleSuiteView = !!scenarioSetId;
  const itemCount = groupBy === "none" ? batchRuns.length : groups.length;
  const hasFiltersApplied = !!(filters.scenarioId || filters.passFailStatus);

  return (
    <VStack align="stretch" gap={0} height="100%">
      {/* Header: only shown in all-runs view. Rendered during loading too
          (with a totals placeholder) so the skeleton doesn't shift layout. */}
      {!isSingleSuiteView && (
        <Box paddingX={6} paddingY={4}>
          <Text fontSize="xl" fontWeight="semibold">
            All Runs
          </Text>
          {isLoading ? (
            <Skeleton height="20px" width="220px" marginTop={0.5} />
          ) : (
          <HStack gap={2} data-testid="all-runs-header-totals">
            <Text fontSize="sm" color="fg.muted">
              {groupBy === "none"
                ? `${batchRuns.length} ${batchRuns.length === 1 ? "execution" : "executions"} · `
                : `${groups.length} ${groups.length === 1 ? "group" : "groups"} · `}
              {totals.runCount} {totals.runCount === 1 ? "run" : "runs"}
            </Text>
            <RunSummaryCounts
              summary={{
                passedCount: totals.passedCount,
                failedCount: totals.failedCount,
                stalledCount: 0,
                cancelledCount: 0,
                completedCount: totals.passedCount + totals.failedCount,
                inProgressCount: totals.pendingCount,
                queuedCount: 0,
                passRate: 0,
                totalCount: totals.runCount,
                totalCost: null,
                averageAgentLatencyMs: null,
                totalDurationMs: null,
                agentLatencyStats: null,
                agentCostStats: null,
                averageAgentCost: null,
              }}
            />
          </HStack>
          )}
        </Box>
      )}

      {/* Filters — fixed above the scrollable run list. position=relative
          anchors the _after divider; without it the pseudo resolves against
          the document and adds phantom scroll height to the page container. */}
      <Box
        paddingX={6}
        paddingY={4}
        bg="bg"
        position="relative"
        _after={{
          content: '""',
          position: "absolute",
          bottom: "-5px",
          left: 0,
          right: 0,
          height: "5px",
          borderTop: "1px solid var(--chakra-colors-border-muted)",
          background: "linear-gradient(to bottom, color-mix(in srgb, var(--chakra-colors-border-muted) 40%, transparent), transparent)",
          pointerEvents: "none",
        }}
      >
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={filters}
          onFiltersChange={handleFiltersChange}
          groupBy={groupBy}
          onGroupByChange={setGroupBy}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      </Box>

      <ShadowDivider scrollRef={runListRef} />

      {/* Run list — own scroll container so RunRow sticky headers don't clash with filters.
          Skeleton renders in the list slot only while nothing has been fetched
          yet (the hook's isLoading is gated on zero fetched pages), keeping
          the header and filter bar in place so nothing shifts when data lands. */}
      {isLoading ? (
        <RunHistorySkeleton />
      ) : itemCount === 0 && !showInitPlaceholder ? (
        <EmptyState.Root paddingY={12}>
          <EmptyState.Content>
            <EmptyState.Indicator>
              <FlaskConical size={28} />
            </EmptyState.Indicator>
            <EmptyState.Title>
              {hasFiltersApplied ? "No matching runs" : "No runs yet"}
            </EmptyState.Title>
            <EmptyState.Description>
              {hasFiltersApplied
                ? "No runs match the selected filters."
                : isSingleSuiteView
                  ? "Run this suite to see results here."
                  : "Execute a suite to see results here."}
            </EmptyState.Description>
          </EmptyState.Content>
        </EmptyState.Root>
      ) : (
        <VStack ref={runListRef} align="stretch" gap={0} flex={1} minH={0} overflow="auto">
          {showInitPlaceholder && (
            <RunRow loading />
          )}
          {groupBy === "none"
            ? batchRuns.map((batchRun) => {
                const summary = computeBatchRunSummary({ batchRun });
                const isExpanded = expandedIds.has(batchRun.batchRunId);

                // Resolve suite/external-set name for all-runs view
                const suiteName = suiteNameMap
                  ? (resolveOriginLabel({
                      scenarioSetId: batchRun.scenarioSetId,
                      suiteNameMap,
                    }) ?? undefined)
                  : undefined;

                return (
                  <RunRow
                    key={batchRun.batchRunId}
                    batchRun={batchRun}
                    summary={summary}
                    isExpanded={isExpanded}
                    onToggle={() => toggleExpanded(batchRun.batchRunId)}
                    resolveTargetName={resolveTargetName}
                    onScenarioRunClick={handleScenarioRunClick}
                    expectedJobCount={expectedJobCount}
                    suiteName={suiteName}
                    viewMode={viewMode}
                    onCancelRun={isPlatformManaged(batchRun.scenarioSetId ?? scenarioSetId) ? createCancelRunHandler(batchRun.scenarioSetId ?? scenarioSetId ?? "") : undefined}
                    onCancelAll={isPlatformManaged(batchRun.scenarioSetId ?? scenarioSetId) ? () => handleCancelAll(batchRun.batchRunId, batchRun.scenarioSetId ?? scenarioSetId ?? "") : undefined}
                    isCancellingBatch={isCancellingBatch}
                    cancellingJobId={cancellingJobId}
                    isHighlighted={highlightedBatchId === batchRun.batchRunId}
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
                    onToggle={() => toggleExpanded(group.groupKey)}
                    onScenarioRunClick={handleScenarioRunClick}
                    resolveTargetName={resolveTargetName}
                    viewMode={viewMode}
                    onCancelRun={isPlatformManaged(scenarioSetId) ? createCancelRunHandler(scenarioSetId ?? "") : undefined}
                    cancellingJobId={cancellingJobId}
                  />
                );
              })}

          {/* Load More button */}
          {hasMore && (
            <Box
              paddingX={6}
              paddingY={6}
              display="flex"
              justifyContent="center"
            >
              <Button variant="outline" onClick={loadMore}>
                Load More...
              </Button>
            </Box>
          )}
        </VStack>
      )}
    </VStack>
  );
}

