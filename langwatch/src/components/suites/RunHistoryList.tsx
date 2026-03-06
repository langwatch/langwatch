/**
 * Run history list for a suite.
 *
 * Fetches run data from ElasticSearch via the existing scenarioEvents tRPC endpoint,
 * groups results by batch run (default), scenario, or target, and renders collapsible
 * rows with filters and footer.
 *
 * Uses the suite's setId (__internal__<suiteId>__suite) to query the scenario events.
 */

import { Box, Button, EmptyState, Spinner, Text, VStack } from "@chakra-ui/react";
import { Play, Inbox } from "lucide-react";
import type { SimulationSuite } from "@prisma/client";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useTargetNameMap } from "~/hooks/useTargetNameMap";
import { parseSuiteTargets } from "~/server/suites/types";
import { getSuiteSetId } from "~/server/suites/suite-set-id";
import { api } from "~/utils/api";
import { useDrawer } from "~/hooks/useDrawer";
import { useSimulationUpdateListener } from "~/hooks/useSimulationUpdateListener";
import type { Period } from "~/components/PeriodSelector";
import { RunHistoryFilters } from "./RunHistoryFilters";
import { RunHistoryFooter } from "./RunHistoryFooter";
import { RunRow } from "./RunRow";
import { GroupRow } from "./GroupRow";
import { QueueStatusBanner } from "./QueueStatusBanner";
import { useRunHistoryStore } from "./useRunHistoryStore";
import { getAdaptivePollingInterval } from "./getAdaptivePollingInterval";
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

type RunHistoryListProps = {
  suite: SimulationSuite;
  onStatsReady?: (stats: RunHistoryStats) => void;
  period?: Period;
  onRun?: () => void;
};

export function RunHistoryList({ suite, onStatsReady, period, onRun }: RunHistoryListProps) {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const setId = getSuiteSetId(suite.id);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const hasAutoExpanded = useRef(false);

  // Use zustand store for filters, groupBy, and viewMode
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

  // Reset expanded state when groupBy changes
  const prevGroupByForExpansion = useRef(groupBy);
  useEffect(() => {
    if (prevGroupByForExpansion.current !== groupBy) {
      setExpandedIds(new Set());
      hasAutoExpanded.current = false;
      prevGroupByForExpansion.current = groupBy;
    }
  }, [groupBy]);

  // Fetch queue status for pending/active jobs
  const { data: queueStatus } = api.suites.getQueueStatus.useQuery(
    {
      projectId: project?.id ?? "",
      suiteId: suite.id,
    },
    {
      enabled: !!project,
      refetchInterval: 5000,
    },
  );

  // Banner only shows waiting jobs (active jobs appear in ES run history)
  const hasPendingJobs = (queueStatus?.waiting ?? 0) > 0;

  // Poll faster when any jobs are in the queue (waiting or active),
  // since active jobs will soon produce ES events we want to show quickly
  const hasQueuedJobs =
    (queueStatus?.waiting ?? 0) > 0 || (queueStatus?.active ?? 0) > 0;

  const [adaptiveIntervalMs, setAdaptiveIntervalMs] = useState(15000);

  // Fetch all run data for this suite (unpaginated).
  // Date filtering is applied client-side to avoid capping results.
  const {
    data: runData,
    isLoading,
    error,
    refetch: refetchRunData,
  } = api.scenarios.getAllScenarioSetRunData.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioSetId: setId,
    },
    {
      enabled: !!project,
      refetchInterval: adaptiveIntervalMs,
    },
  );

  // Period-filter runs for adaptive polling so active runs outside the visible
  // date range don't keep triggering fast polling unnecessarily.
  const runsForAdaptivePolling = useMemo(() => {
    if (!runData) return [];
    if (!period) return runData;
    const startMs = period.startDate.getTime();
    const endMs = period.endDate.getTime();
    return runData.filter((r) => r.timestamp >= startMs && r.timestamp <= endMs);
  }, [runData, period]);

  // Recompute adaptive polling whenever run data or queue status changes
  useEffect(() => {
    setAdaptiveIntervalMs(
      hasQueuedJobs
        ? 3000
        : getAdaptivePollingInterval({ runs: runsForAdaptivePolling }),
    );
  }, [hasQueuedJobs, runsForAdaptivePolling]);

  // SSE subscription for real-time updates scoped to this suite's scenarioSetId
  useSimulationUpdateListener({
    projectId: project?.id ?? "",
    refetch: refetchRunData,
    enabled: !!project,
    filter: { scenarioSetId: setId },
  });

  // Fetch scenarios for filter options and name resolution
  const { data: scenarios } = api.scenarios.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );

  const targetNameMap = useTargetNameMap();

  // Compute expected job count from suite config
  const targets = useMemo(
    () => parseSuiteTargets(suite.targets),
    [suite.targets],
  );
  const expectedJobCount =
    suite.scenarioIds.length * targets.length * suite.repeatCount;

  // Resolve single target name if suite has exactly one target
  const singleTargetName = useMemo(() => {
    if (targets.length === 1) {
      const target = targets[0];
      return target ? targetNameMap.get(target.referenceId) ?? null : null;
    }
    return null;
  }, [targets, targetNameMap]);

  // Resolve target name per scenario run from metadata.langwatch.targetReferenceId
  const resolveTargetName = useCallback(
    (scenarioRun: ScenarioRunData): string | null => {
      if (singleTargetName) return singleTargetName;
      const refId = scenarioRun.metadata?.langwatch?.targetReferenceId;
      if (!refId) return null;
      return targetNameMap.get(refId) ?? null;
    },
    [singleTargetName, targetNameMap],
  );

  // Build scenario options for filter dropdown
  const scenarioOptions = useMemo(() => {
    if (!scenarios) return [];
    return suite.scenarioIds
      .map((id) => {
        const s = scenarios.find((sc) => sc.id === id);
        return s ? { id: s.id, name: s.name } : null;
      })
      .filter(Boolean) as Array<{ id: string; name: string }>;
  }, [scenarios, suite.scenarioIds]);

  // Apply filters to raw run data (date filtering is done server-side)
  const filteredRuns = useMemo(() => {
    if (!runData) return [];

    let runs: ScenarioRunData[] = runData;

    if (period) {
      const startMs = period.startDate.getTime();
      const endMs = period.endDate.getTime();
      runs = runs.filter((r) => r.timestamp >= startMs && r.timestamp <= endMs);
    }

    if (filters.scenarioId) {
      runs = runs.filter((r) => r.scenarioId === filters.scenarioId);
    }

    if (filters.passFailStatus === "pass") {
      runs = runs.filter((r) => r.status === ScenarioRunStatus.SUCCESS);
    } else if (filters.passFailStatus === "fail") {
      runs = runs.filter(
        (r) => r.status === ScenarioRunStatus.ERROR || r.status === ScenarioRunStatus.FAILED,
      );
    } else if (filters.passFailStatus === "stalled") {
      runs = runs.filter((r) => r.status === ScenarioRunStatus.STALLED);
    }

    return runs;
  }, [runData, filters.scenarioId, filters.passFailStatus, period]);

  // Group filtered runs by batch
  const batchRuns = useMemo(() => {
    return groupRunsByBatchId({ runs: filteredRuns });
  }, [filteredRuns]);

  // Group filtered runs by scenario or target (when groupBy is not "none")
  const groups = useMemo(() => {
    if (groupBy === "none") return [];

    return groupBy === "scenario"
      ? groupRunsByScenarioId({ runs: filteredRuns })
      : groupRunsByTarget({ runs: filteredRuns, targetNameMap });
  }, [groupBy, filteredRuns, targetNameMap]);

  // Auto-expand all rows when data first loads
  useEffect(() => {
    if (!hasAutoExpanded.current) {
      if (groupBy === "none" && batchRuns.length > 0) {
        setExpandedIds(new Set(batchRuns.map((b) => b.batchRunId)));
        hasAutoExpanded.current = true;
      } else if (groupBy !== "none" && groups.length > 0) {
        setExpandedIds(new Set(groups.map((g) => g.groupKey)));
        hasAutoExpanded.current = true;
      }
    }
  }, [batchRuns, groups, groupBy]);

  const totals = useMemo(
    () => computeRunHistoryTotals({ runs: filteredRuns }),
    [filteredRuns],
  );

  const lastActivityTimestamp =
    groupBy === "none"
      ? batchRuns[0]?.timestamp ?? null
      : groups[0]?.timestamp ?? null;

  // Notify parent when stats are ready
  useEffect(() => {
    if (onStatsReady) {
      const finishedCount = totals.passedCount + totals.failedCount;
      const passRate = finishedCount > 0 ? (totals.passedCount / finishedCount) * 100 : 0;

      onStatsReady({
        runCount: totals.runCount,
        passRate,
        lastActivityTimestamp,
      });
    }
  }, [totals, lastActivityTimestamp, onStatsReady]);

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
    (newFilters: { scenarioId: string; passFailStatus: string }) => {
      setFilters(newFilters);
    },
    [setFilters],
  );

  if (isLoading) {
    return (
      <VStack paddingY={8} align="center">
        <Spinner />
        <Text fontSize="sm" color="fg.muted">
          Loading run history...
        </Text>
      </VStack>
    );
  }

  if (error) {
    return (
      <VStack paddingY={8} align="center">
        <Text fontSize="sm" color="red.500">
          Failed to load run history
        </Text>
        <Text fontSize="xs" color="fg.muted">
          {error.message}
        </Text>
      </VStack>
    );
  }

  if (!runData || runData.length === 0) {
    return (
      <VStack paddingY={8} align="center" gap={4}>
        {hasPendingJobs && (
          <Box paddingX={6}>
            <QueueStatusBanner queueStatus={queueStatus} />
          </Box>
        )}
        <EmptyState.Root>
          <EmptyState.Content>
            <EmptyState.Indicator>
              <Inbox size={32} />
            </EmptyState.Indicator>
            <EmptyState.Title>No runs yet</EmptyState.Title>
            <EmptyState.Description>
              Run this suite to evaluate your scenarios and see results here.
            </EmptyState.Description>
            {onRun && (
              <Button colorPalette="blue" onClick={onRun}>
                <Play size={14} />
                Run Suite
              </Button>
            )}
          </EmptyState.Content>
        </EmptyState.Root>
      </VStack>
    );
  }

  return (
    <VStack align="stretch" gap={0} flex={1}>
      {/* Filter bar with group-by selector */}
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

      {/* Queue status banner */}
      {hasPendingJobs && (
        <Box paddingX={6} paddingBottom={3}>
          <QueueStatusBanner queueStatus={queueStatus} />
        </Box>
      )}

      {/* Run history rows — no overflow here; parent provides the scrollport for sticky headers */}
      {filteredRuns.length === 0 &&
      runData &&
      runData.length > 0 &&
      period &&
      !filters.scenarioId &&
      !filters.passFailStatus ? (
        <Box paddingX={6} paddingY={8} textAlign="center">
          <Text color="fg.muted">No runs in the selected time period.</Text>
        </Box>
      ) : (groupBy === "none" ? batchRuns.length : groups.length) === 0 && (filters.scenarioId || filters.passFailStatus) ? (
        <Box paddingX={6} paddingY={8} textAlign="center">
          <Text color="fg.muted">No runs match the selected filters.</Text>
        </Box>
      ) : (
      <VStack align="stretch" gap={0} flex={1}>
        {groupBy === "none"
          ? batchRuns.map((batchRun) => {
              const summary = computeBatchRunSummary({ batchRun });
              return (
                <RunRow
                  key={batchRun.batchRunId}
                  batchRun={batchRun}
                  summary={summary}
                  isExpanded={expandedIds.has(batchRun.batchRunId)}
                  onToggle={() => handleToggle(batchRun.batchRunId)}
                  resolveTargetName={resolveTargetName}
                  onScenarioRunClick={handleScenarioRunClick}
                  expectedJobCount={expectedJobCount}
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
    </VStack>
  );
}
