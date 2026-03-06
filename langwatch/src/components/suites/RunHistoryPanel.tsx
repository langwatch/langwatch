/**
 * Unified run history panel for both single-suite and cross-suite views.
 *
 * When scenarioSetId is provided, filters to that suite.
 * When absent, shows runs across all suites.
 * Both paths use cursor-based pagination with Load More.
 */

import { Box, Button, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useTargetNameMap } from "~/hooks/useTargetNameMap";
import { useDrawer } from "~/hooks/useDrawer";
import { api } from "~/utils/api";
import type { Period } from "~/components/PeriodSelector";
import { extractSuiteId } from "~/server/suites/suite-set-id";
import {
  RunHistoryFilters,
  type RunHistoryFilterValues,
} from "./RunHistoryFilters";
import { RunRow } from "./RunRow";
import { GroupRow } from "./GroupRow";
import { useRunHistoryStore } from "./useRunHistoryStore";
import {
  computeBatchRunSummary,
  computeGroupSummary,
  computeRunHistoryTotals,
  groupRunsByBatchId,
  groupRunsByScenarioId,
  groupRunsByTarget,
} from "./run-history-transforms";

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
};

type PageData = {
  runs: ScenarioRunData[];
  scenarioSetIds: Record<string, string>;
  hasMore: boolean;
  nextCursor?: string;
};

export function RunHistoryPanel({
  scenarioSetId,
  period,
  onStatsReady,
  expectedJobCount,
  suiteNameMap,
}: RunHistoryPanelProps) {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const hasAutoExpanded = useRef(false);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [pages, setPages] = useState<PageData[]>([]);
  const prevCursorRef = useRef<string | undefined>(undefined);

  // Use zustand store for filters, groupBy, and viewMode with URL sync
  const groupBy = useRunHistoryStore((s) => s.groupBy);
  const viewMode = useRunHistoryStore((s) => s.viewMode);
  const filters = useRunHistoryStore((s) => s.filters);
  const setGroupBy = useRunHistoryStore((s) => s.setGroupBy);
  const setViewMode = useRunHistoryStore((s) => s.setViewMode);
  const setFilters = useRunHistoryStore((s) => s.setFilters);
  const syncToUrl = useRunHistoryStore((s) => s.syncToUrl);
  const hydrateFromUrl = useRunHistoryStore((s) => s.hydrateFromUrl);

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

  // Reset pagination when period changes
  const startDateMs = period.startDate.getTime();
  const endDateMs = period.endDate.getTime();
  useEffect(() => {
    setCursor(undefined);
    setPages([]);
  }, [startDateMs, endDateMs]);

  // Fetch run data using the unified endpoint
  const {
    data: runDataResult,
    isLoading,
    error,
  } = api.scenarios.getSuiteRunData.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioSetId,
      limit: 20,
      cursor,
      startDate: startDateMs,
      endDate: endDateMs,
    },
    {
      enabled: !!project,
      refetchInterval: pages.length <= 1 ? 5000 : undefined,
    },
  );

  // Accumulate pages as data arrives
  useEffect(() => {
    if (!runDataResult) return;

    if (cursor === undefined) {
      setPages([runDataResult]);
    } else if (cursor !== prevCursorRef.current) {
      setPages((prev) => [...prev, runDataResult]);
    }
    prevCursorRef.current = cursor;
  }, [runDataResult, cursor]);

  // Flatten accumulated pages
  const allRuns = useMemo(() => pages.flatMap((p) => p.runs), [pages]);

  const allScenarioSetIds = useMemo(() => {
    const merged: Record<string, string> = {};
    for (const page of pages) {
      Object.assign(merged, page.scenarioSetIds);
    }
    return merged;
  }, [pages]);

  const hasMore =
    pages.length > 0 ? (pages[pages.length - 1]?.hasMore ?? false) : false;

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
      return targetNameMap.get(refId) ?? null;
    },
    [targetNameMap],
  );

  // Build scenario options for filter dropdown
  const scenarioOptions = useMemo(() => {
    if (!scenarios) return [];
    return scenarios.map((s) => ({ id: s.id, name: s.name }));
  }, [scenarios]);

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

  // Reset expanded state when groupBy changes
  const prevGroupByForExpansion = useRef(groupBy);
  useEffect(() => {
    if (prevGroupByForExpansion.current !== groupBy) {
      setExpandedIds(new Set());
      hasAutoExpanded.current = false;
      prevGroupByForExpansion.current = groupBy;
    }
  }, [groupBy]);

  // Auto-expand: all rows on first load, and any newly arriving rows
  useEffect(() => {
    if (groupBy === "none" && batchRuns.length > 0) {
      const currentIds = new Set(batchRuns.map((b) => b.batchRunId));
      if (!hasAutoExpanded.current) {
        setExpandedIds(currentIds);
        hasAutoExpanded.current = true;
      } else {
        setExpandedIds((prev) => {
          const newIds = [...currentIds].filter((id) => !prev.has(id));
          if (newIds.length === 0) return prev;
          const next = new Set(prev);
          for (const id of newIds) next.add(id);
          return next;
        });
      }
    } else if (groupBy !== "none" && groups.length > 0) {
      const currentKeys = new Set(groups.map((g) => g.groupKey));
      if (!hasAutoExpanded.current) {
        setExpandedIds(currentKeys);
        hasAutoExpanded.current = true;
      } else {
        setExpandedIds((prev) => {
          const newKeys = [...currentKeys].filter((k) => !prev.has(k));
          if (newKeys.length === 0) return prev;
          const next = new Set(prev);
          for (const k of newKeys) next.add(k);
          return next;
        });
      }
    }
  }, [groupBy, batchRuns, groups]);

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

  const toggleExpanded = useCallback((id: string) => {
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

  const handleLoadMore = useCallback(() => {
    const lastPage = pages[pages.length - 1];
    if (lastPage?.nextCursor) {
      setCursor(lastPage.nextCursor);
    }
  }, [pages]);

  // --- Render ---

  if (error) {
    return (
      <Box padding={6}>
        <Text color="red.600">Error loading runs: {error.message}</Text>
      </Box>
    );
  }

  if (isLoading && pages.length === 0) {
    return (
      <Box padding={6} display="flex" justifyContent="center">
        <Spinner size="lg" data-testid="loading-spinner" />
      </Box>
    );
  }

  const isSingleSuiteView = !!scenarioSetId;
  const itemCount = groupBy === "none" ? batchRuns.length : groups.length;
  const hasFiltersApplied = !!(filters.scenarioId || filters.passFailStatus);

  return (
    <VStack align="stretch" gap={0} height="100%" overflow={isSingleSuiteView ? undefined : "auto"}>
      {/* Header: only shown in all-runs view */}
      {!isSingleSuiteView && (
        <Box paddingX={6} paddingY={4}>
          <Text fontSize="xl" fontWeight="bold">
            All Runs
          </Text>
          <HStack gap={3} data-testid="all-runs-header-totals">
            <Text fontSize="sm" color="fg.muted">
              {groupBy === "none"
                ? `${batchRuns.length} ${batchRuns.length === 1 ? "execution" : "executions"} · `
                : `${groups.length} ${groups.length === 1 ? "group" : "groups"} · `}
              {totals.runCount} {totals.runCount === 1 ? "run" : "runs"}
            </Text>
            <Text fontSize="sm" color="green.600">
              {totals.passedCount} passed
            </Text>
            <Text fontSize="sm" color="red.600">
              {totals.failedCount} failed
            </Text>
          </HStack>
        </Box>
      )}

      {/* Filters */}
      <Box paddingX={6} paddingY={4}>
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

      {/* Run list */}
      {itemCount === 0 ? (
        <Box paddingX={6} paddingY={8} textAlign="center">
          <Text color="fg.muted">
            {hasFiltersApplied
              ? "No runs match the selected filters."
              : isSingleSuiteView
                ? "Run this suite to see results here."
                : "No runs yet. Execute a suite to see results here."}
          </Text>
        </Box>
      ) : (
        <>
          <VStack align="stretch" gap={0} flex={isSingleSuiteView ? 1 : undefined}>
            {groupBy === "none"
              ? batchRuns.map((batchRun) => {
                  const summary = computeBatchRunSummary({ batchRun });
                  const isExpanded = expandedIds.has(batchRun.batchRunId);

                  // Resolve suite name for all-runs view
                  let suiteName: string | undefined;
                  if (suiteNameMap && batchRun.scenarioSetId) {
                    const suiteId = extractSuiteId(batchRun.scenarioSetId);
                    suiteName =
                      suiteId
                        ? (suiteNameMap.get(suiteId) ?? undefined)
                        : undefined;
                  }

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
                    />
                  );
                })}
          </VStack>

          {/* Load More button */}
          {hasMore && (
            <Box
              paddingX={6}
              paddingTop={4}
              display="flex"
              justifyContent="center"
            >
              <Button variant="outline" onClick={handleLoadMore}>
                Load More...
              </Button>
            </Box>
          )}
        </>
      )}
    </VStack>
  );
}
