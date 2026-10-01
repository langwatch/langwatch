/**
 * Unified run history panel for both single-suite and cross-suite views.
 */

import type { Period } from "@langwatch/analytics-browser-kit";
import { useDrawer } from "@langwatch/browser-host/drawer";
import { showErrorToast } from "@langwatch/browser-host/errors";
import { useRouter } from "@langwatch/browser-host/use-router";
import {
  Box,
  Button,
  EmptyState,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { toaster } from "@langwatch/design-system/toaster";
import { LangyContextTarget, scenarioContextChip } from "@langwatch/langy-browser-kit";
import { isOnPlatformSet, ScenarioRunStatus } from "@langwatch/scenario-contract";
import type { ScenarioRunData } from "@langwatch/scenario-contract";
import {
  computeBatchRunSummary,
  computeGroupSummary,
  computeRunHistoryTotals,
  GroupRow,
  groupRunsByBatchId,
  groupRunsByScenarioId,
  groupRunsByTarget,
  resolveOriginLabel,
  RunHistoryFilters,
  type RunHistoryFilterValues,
  RunHistorySkeleton,
  RunRow,
  RunSummaryCounts,
  ScenarioRunExportDialog,
  type ScenarioRunContextRenderer,
  useAutoExpansion,
  useRunHistoryStore,
  useScrollToBatch,
} from "@langwatch/suite-browser-kit";
import { isSuiteSetId } from "@langwatch/suite-contract";
import { FlaskConical, RefreshCw } from "lucide-react";
import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { HandledErrorAlert } from "../../../behavior/errors.tsx";
import { SetupWithAgentButton } from "../../../behavior/lent-trace.tsx";
import { api } from "../../../behavior/scenario-api.ts";
import { useCancelScenarioRun } from "../../../behavior/suites/use-cancel-scenario-run.ts";
import { useExportScenarioRuns } from "../../../behavior/suites/use-export-scenario-runs.ts";
import { usePrefetchRunState } from "../../../behavior/suites/use-prefetch-run-state.ts";
import { useRunHistoryPagination } from "../../../behavior/suites/use-run-history-pagination.ts";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";
import { useSimulationUpdateListener } from "../../../behavior/use-simulation-update-listener.ts";
import { useTargetNameMap } from "../../../behavior/use-target-name-map.ts";
import { ShadowDivider } from "../../elements/shadow-divider.tsx";

const renderScenarioContext: ScenarioRunContextRenderer = ({ scenarioRunId, name, children }) => (
  <LangyContextTarget target={scenarioContextChip({ scenarioId: scenarioRunId, name })}>
    {children}
  </LangyContextTarget>
);

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

function emptyRunsDescription({
  hasFiltersApplied,
  isSingleSuiteView,
}: {
  hasFiltersApplied: boolean;
  isSingleSuiteView: boolean;
}): string {
  if (hasFiltersApplied) return "No runs match the selected filters.";
  if (isSingleSuiteView) return "Run this suite to see results here.";
  return "Execute a suite to see results here.";
}

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
  const prefetchRunState = usePrefetchRunState();

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

  useRunHistoryUrlSync({ router, groupBy, filters, syncToUrl, hydrateFromUrl });

  // Live updates: SSE invalidates getSuiteRunData directly (no refetch
  // callback needed). Its connection state disables fallback polling.
  const { isConnected: sseConnected } = useSimulationUpdateListener({
    projectId: project?.id ?? "",
    enabled: !!project?.id,
    debounceMs: 500,
    filter: scenarioSetId ? { scenarioSetId } : undefined,
  });

  // Pagination
  const startDateMs = period.startDate.epochMilliseconds;
  const endDateMs = period.endDate.epochMilliseconds;
  const { allRuns, allScenarioSetIds, hasMore, loadMore, isLoading, error, refetch } =
    useRunHistoryPagination({ scenarioSetId, startDateMs, sseConnected });

  // CSV export, scoped to whatever this panel is currently showing.
  const {
    isDialogOpen: isExportDialogOpen,
    openExportDialog,
    closeExportDialog,
    startExport,
    isExporting,
    progress: exportProgress,
    cancelExport,
  } = useExportScenarioRuns({
    projectId: project?.id,
    scenarioSetId,
    scenarioId: filters.scenarioId || undefined,
    passFailStatus: filters.passFailStatus
      ? (filters.passFailStatus as "pass" | "fail" | "stalled")
      : undefined,
    startDate: startDateMs,
    endDate: endDateMs,
  });

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
  const scenarioOptions = useMemo(
    () => (scenarios ?? []).map((s) => ({ id: s.id, name: s.name })),
    [scenarios],
  );

  const { cancellingJobId, isCancellingBatch, createCancelRunHandler, handleCancelAll } =
    useRunCancellation({ projectId: project?.id, refetch });

  const filteredRuns = useMemo(() => filterRuns({ runs: allRuns, filters }), [allRuns, filters]);

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
  const groups = useMemo(
    () => groupRuns({ groupBy, runs: filteredRuns, targetNameMap }),
    [groupBy, filteredRuns, targetNameMap],
  );

  // Auto-expansion
  const { expandedIds, toggleExpanded } = useAutoExpansion({
    panelKey: scenarioSetId ?? "all-runs",
    groupBy,
    batchRuns,
    groups,
  });

  const totals = useMemo(() => computeRunHistoryTotals({ runs: filteredRuns }), [filteredRuns]);

  const lastActivityTimestamp = (groupBy === "none" ? batchRuns[0] : groups[0])?.timestamp ?? null;

  useReportStats({ totals, lastActivityTimestamp, onStatsReady });

  // Scroll-to-batch highlighting
  const { highlightedBatchId } = useScrollToBatch({ highlightBatchId });

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
  const showInitPlaceholder = useMemo(
    () => !!pendingBatchRunId && !batchRuns.some((b) => b.batchRunId === pendingBatchRunId),
    [pendingBatchRunId, batchRuns],
  );

  // --- Render ---

  if (error) {
    // The alert is this panel's whole error surface: one component that reads
    // the handled payload, an authored non-5xx message, or the generic unknown
    // state, and carries the tips, docs link and copyable error id with it.
    return (
      <EmptyState.Root paddingY={12}>
        <EmptyState.Content>
          <Box maxWidth="420px" width="100%">
            <HandledErrorAlert error={error} fallbackTitle="Couldn't load runs" />
          </Box>
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            <RefreshCw size={14} /> Try again
          </Button>
        </EmptyState.Content>
      </EmptyState.Root>
    );
  }

  const isSingleSuiteView = !!scenarioSetId;
  const groupCancelRun = isPlatformManaged(scenarioSetId)
    ? createCancelRunHandler(scenarioSetId ?? "")
    : undefined;
  const itemCount = groupBy === "none" ? batchRuns.length : groups.length;
  const hasFiltersApplied = !!(filters.scenarioId || filters.passFailStatus);
  const showEmptyState = !isLoading && itemCount === 0 && !showInitPlaceholder;
  const showRunList = !isLoading && !showEmptyState;

  return (
    <VStack align="stretch" gap={0} height="100%">
      {/* Header: only shown in all-runs view. Rendered during loading too
          (with a totals placeholder) so the skeleton doesn't shift layout. */}
      {!isSingleSuiteView && (
        <AllRunsHeader
          isLoading={isLoading}
          groupBy={groupBy}
          executionCount={batchRuns.length}
          groupCount={groups.length}
          totals={totals}
        />
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
          background:
            "linear-gradient(to bottom, color-mix(in srgb, var(--chakra-colors-border-muted) 40%, transparent), transparent)",
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
          onExport={openExportDialog}
          // totals.runCount counts the pages fetched so far, not what the server would
          // export, so it is never compared against a total — that would block a valid
          // export of a longer history.
          isExportDisabled={isLoading || (totals.runCount === 0 && !hasMore)}
          isExporting={isExporting}
          exportProgress={exportProgress}
          onCancelExport={cancelExport}
        />
      </Box>

      <ShadowDivider scrollRef={runListRef} />

      {/* Run list — own scroll container so RunRow sticky headers don't clash with filters.
          Skeleton renders in the list slot only while nothing has been fetched
          yet (the hook's isLoading is gated on zero fetched pages), keeping
          the header and filter bar in place so nothing shifts when data lands. */}
      {isLoading && <RunHistorySkeleton />}
      {showEmptyState && (
        <RunsEmptyState
          hasFiltersApplied={hasFiltersApplied}
          isSingleSuiteView={isSingleSuiteView}
        />
      )}
      {showRunList && (
        <VStack ref={runListRef} align="stretch" gap={0} flex={1} minH={0} overflow="auto">
          {showInitPlaceholder && <RunRow loading />}
          {groupBy === "none"
            ? batchRuns.map((batchRun) => (
                <BatchRunItem
                  key={batchRun.batchRunId}
                  batchRun={batchRun}
                  fallbackSetId={scenarioSetId}
                  isExpanded={expandedIds.has(batchRun.batchRunId)}
                  onToggle={() => toggleExpanded(batchRun.batchRunId)}
                  suiteNameMap={suiteNameMap}
                  isHighlighted={highlightedBatchId === batchRun.batchRunId}
                  resolveTargetName={resolveTargetName}
                  onScenarioRunClick={handleScenarioRunClick}
                  expectedJobCount={expectedJobCount}
                  viewMode={viewMode}
                  createCancelRunHandler={createCancelRunHandler}
                  handleCancelAll={handleCancelAll}
                  isCancellingBatch={isCancellingBatch}
                  cancellingJobId={cancellingJobId}
                  onPrefetchRun={prefetchRunState}
                />
              ))
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
                    onCancelRun={groupCancelRun}
                    cancellingJobId={cancellingJobId}
                    onPrefetchRun={prefetchRunState}
                    renderScenarioContext={renderScenarioContext}
                  />
                );
              })}

          {/* Load More button */}
          {hasMore && (
            <Box paddingX={6} paddingY={6} display="flex" justifyContent="center">
              <Button variant="outline" onClick={loadMore}>
                Load More...
              </Button>
            </Box>
          )}
        </VStack>
      )}

      <ScenarioRunExportDialog
        isOpen={isExportDialogOpen}
        onClose={closeExportDialog}
        onExport={startExport}
        runCount={totals.runCount}
        hasFiltersApplied={hasFiltersApplied}
      />
    </VStack>
  );
}

type RunHistoryRouter = ReturnType<typeof useRouter>;
type RunHistoryState = ReturnType<typeof useRunHistoryStore.getState>;

/** Reads the filters from the URL once, then writes every change back to it. */
function useRunHistoryUrlSync({
  router,
  groupBy,
  filters,
  syncToUrl,
  hydrateFromUrl,
}: {
  router: RunHistoryRouter;
  groupBy: RunHistoryState["groupBy"];
  filters: RunHistoryState["filters"];
  syncToUrl: RunHistoryState["syncToUrl"];
  hydrateFromUrl: RunHistoryState["hydrateFromUrl"];
}) {
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
}

/** The runs the scenario and pass/fail filters keep. */
function filterRuns({
  runs,
  filters,
}: {
  runs: ScenarioRunData[];
  filters: RunHistoryState["filters"];
}): ScenarioRunData[] {
  if (runs.length === 0) return [];

  let filtered = runs;

  if (filters.scenarioId) {
    filtered = filtered.filter((r) => r.scenarioId === filters.scenarioId);
  }

  if (filters.passFailStatus === "pass") {
    filtered = filtered.filter((r) => r.status === ScenarioRunStatus.SUCCESS);
  } else if (filters.passFailStatus === "fail") {
    filtered = filtered.filter(
      (r) => r.status === ScenarioRunStatus.ERROR || r.status === ScenarioRunStatus.FAILED,
    );
  } else if (filters.passFailStatus === "stalled") {
    filtered = filtered.filter((r) => r.status === ScenarioRunStatus.STALLED);
  }

  return filtered;
}

/** Hands the parent the run count, pass rate and last activity once they change. */
function useReportStats({
  totals,
  lastActivityTimestamp,
  onStatsReady,
}: {
  totals: ReturnType<typeof computeRunHistoryTotals>;
  lastActivityTimestamp: number | null;
  onStatsReady: RunHistoryPanelProps["onStatsReady"];
}) {
  useEffect(() => {
    if (!onStatsReady) return;
    const finishedCount = totals.passedCount + totals.failedCount;
    const passRate = finishedCount > 0 ? (totals.passedCount / finishedCount) * 100 : 0;

    onStatsReady({
      runCount: totals.runCount,
      passRate,
      lastActivityTimestamp,
    });
  }, [totals, lastActivityTimestamp, onStatsReady]);
}

/** Cancels one job or a whole batch, tracking which job is being cancelled. */
function useRunCancellation({
  projectId,
  refetch,
}: {
  projectId: string | undefined;
  refetch: () => unknown;
}) {
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
      showErrorToast({ error, fallbackTitle: "Couldn't cancel job" });
    },
    onCancelBatchSuccess: () => {
      void refetch();
      toaster.create({ title: "Jobs cancelled", type: "success" });
    },
    onCancelBatchError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't cancel jobs" }),
  });
  const createCancelRunHandler = useCallback(
    (setId: string) => (scenarioRun: ScenarioRunData) => {
      if (!projectId) return;
      setCancellingJobId(scenarioRun.scenarioRunId);
      cancelJob({
        projectId,
        scenarioSetId: setId,
        batchRunId: scenarioRun.batchRunId,
        scenarioRunId: scenarioRun.scenarioRunId,
        scenarioId: scenarioRun.scenarioId,
      });
    },
    [projectId, cancelJob],
  );

  const handleCancelAll = useCallback(
    (batchRunId: string, batchRunScenarioSetId: string) => {
      if (!projectId) return;
      cancelBatchRun({
        projectId,
        scenarioSetId: batchRunScenarioSetId,
        batchRunId,
      });
    },
    [projectId, cancelBatchRun],
  );

  return { cancellingJobId, isCancellingBatch, createCancelRunHandler, handleCancelAll };
}

/** Runs the platform queued, which it can also cancel. */
function isPlatformManaged(setId: string | undefined): boolean {
  return !!setId && (isOnPlatformSet(setId) || isSuiteSetId(setId));
}

/** The run plan or external set a batch came from, in the all-runs view. */
function originLabelOf({
  scenarioSetId,
  suiteNameMap,
}: {
  scenarioSetId: string | undefined;
  suiteNameMap: Map<string, string> | undefined;
}): string | undefined {
  if (!suiteNameMap) return undefined;
  return resolveOriginLabel({ scenarioSetId, suiteNameMap }) ?? undefined;
}

/** The all-runs heading with its executions, groups and run totals. */
function AllRunsHeader({
  isLoading,
  groupBy,
  executionCount,
  groupCount,
  totals,
}: {
  isLoading: boolean;
  groupBy: RunHistoryState["groupBy"];
  executionCount: number;
  groupCount: number;
  totals: ReturnType<typeof computeRunHistoryTotals>;
}) {
  return (
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
              ? `${executionCount} ${executionCount === 1 ? "execution" : "executions"} · `
              : `${groupCount} ${groupCount === 1 ? "group" : "groups"} · `}
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
  );
}

function RunsEmptyState({
  hasFiltersApplied,
  isSingleSuiteView,
}: {
  hasFiltersApplied: boolean;
  isSingleSuiteView: boolean;
}) {
  return (
    <EmptyState.Root paddingY={12}>
      <EmptyState.Content>
        <EmptyState.Indicator>
          <FlaskConical size={28} />
        </EmptyState.Indicator>
        <EmptyState.Title>
          {hasFiltersApplied ? "No matching runs" : "No runs yet"}
        </EmptyState.Title>
        <EmptyState.Description>
          {emptyRunsDescription({ hasFiltersApplied, isSingleSuiteView })}
        </EmptyState.Description>
        {/* Only when the project truly has nothing to run yet — a
            filtered-empty list is a search miss, not a setup gap. */}
        {!hasFiltersApplied ? <SetupWithAgentButton surface="simulationRuns" /> : null}
      </EmptyState.Content>
    </EmptyState.Root>
  );
}

type RunRowProps = Extract<ComponentProps<typeof RunRow>, { batchRun: unknown }>;

/** One execution in the ungrouped list, cancellable when the platform queued it. */
function BatchRunItem({
  batchRun,
  fallbackSetId,
  suiteNameMap,
  createCancelRunHandler,
  handleCancelAll,
  ...row
}: {
  batchRun: NonNullable<RunRowProps["batchRun"]>;
  fallbackSetId: string | undefined;
  suiteNameMap: Map<string, string> | undefined;
  createCancelRunHandler: (setId: string) => NonNullable<RunRowProps["onCancelRun"]>;
  handleCancelAll: (batchRunId: string, scenarioSetId: string) => void;
} & Pick<
  RunRowProps,
  | "isExpanded"
  | "onToggle"
  | "isHighlighted"
  | "resolveTargetName"
  | "onScenarioRunClick"
  | "expectedJobCount"
  | "viewMode"
  | "isCancellingBatch"
  | "cancellingJobId"
  | "onPrefetchRun"
>) {
  const setId = batchRun.scenarioSetId ?? fallbackSetId;
  const managed = isPlatformManaged(setId);

  return (
    <RunRow
      {...row}
      batchRun={batchRun}
      summary={computeBatchRunSummary({ batchRun })}
      suiteName={originLabelOf({ scenarioSetId: batchRun.scenarioSetId, suiteNameMap })}
      onCancelRun={managed ? createCancelRunHandler(setId ?? "") : undefined}
      onCancelAll={managed ? () => handleCancelAll(batchRun.batchRunId, setId ?? "") : undefined}
      renderScenarioContext={renderScenarioContext}
    />
  );
}

/** The runs grouped by scenario or by target; none when the list is ungrouped. */
function groupRuns({
  groupBy,
  runs,
  targetNameMap,
}: {
  groupBy: RunHistoryState["groupBy"];
  runs: ScenarioRunData[];
  targetNameMap: ReturnType<typeof useTargetNameMap>;
}) {
  if (groupBy === "none") return [];
  if (groupBy === "scenario") return groupRunsByScenarioId({ runs });
  return groupRunsByTarget({ runs, targetNameMap });
}
