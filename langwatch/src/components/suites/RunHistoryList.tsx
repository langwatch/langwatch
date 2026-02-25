/**
 * Run history list for a suite.
 *
 * Fetches run data from ElasticSearch via the existing scenarioEvents tRPC endpoint,
 * groups results by batch run (default), scenario, or target, and renders collapsible
 * rows with filters and footer.
 *
 * Uses the suite's setId (__internal__<suiteId>__suite) to query the scenario events.
 */

import { Box, Spinner, Text, VStack } from "@chakra-ui/react";
import type { SimulationSuite } from "@prisma/client";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { parseSuiteTargets } from "~/server/suites/types";
import { getSuiteSetId } from "~/server/suites/suite-set-id";
import { api } from "~/utils/api";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import { buildRoutePath } from "~/utils/routes";
import type { Period } from "~/components/PeriodSelector";
import { RunHistoryFilters } from "./RunHistoryFilters";
import { RunHistoryFooter } from "./RunHistoryFooter";
import { RunRow } from "./RunRow";
import { GroupRow } from "./GroupRow";
import { QueueStatusBanner } from "./QueueStatusBanner";
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

type RunHistoryListProps = {
  suite: SimulationSuite;
  onStatsReady?: (stats: RunHistoryStats) => void;
  period?: Period;
};

export function RunHistoryList({ suite, onStatsReady, period }: RunHistoryListProps) {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const setId = getSuiteSetId(suite.id);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const hasAutoExpanded = useRef(false);

  // Use zustand store for filters and groupBy
  const groupBy = useRunHistoryStore((s) => s.groupBy);
  const filters = useRunHistoryStore((s) => s.filters);
  const setGroupBy = useRunHistoryStore((s) => s.setGroupBy);
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

  // Fetch all run data for this suite (unpaginated).
  // Date filtering is applied client-side to avoid capping results.
  const {
    data: runData,
    isLoading,
    error,
  } = api.scenarios.getAllScenarioSetRunData.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioSetId: setId,
    },
    {
      enabled: !!project,
      // Poll faster when jobs are queued, otherwise normal interval
      refetchInterval: hasQueuedJobs ? 3000 : 5000,
    },
  );

  // Fetch scenarios for filter options and name resolution
  const { data: scenarios } = api.scenarios.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );

  // Fetch agents and prompts to resolve target names
  const { data: agents } = api.agents.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );
  const { data: prompts } = api.prompts.getAllPromptsForProject.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );

  // Build target name lookup and compute expected job count
  const targets = useMemo(
    () => parseSuiteTargets(suite.targets),
    [suite.targets],
  );
  const expectedJobCount =
    suite.scenarioIds.length * targets.length * suite.repeatCount;
  const targetNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (agents) {
      for (const agent of agents) {
        map.set(agent.id, agent.name);
      }
    }
    if (prompts) {
      for (const prompt of prompts) {
        map.set(prompt.id, prompt.handle ?? prompt.id);
      }
    }
    return map;
  }, [agents, prompts]);

  // Resolve single target name if suite has exactly one target
  const singleTargetName = useMemo(() => {
    if (targets.length === 1) {
      const target = targets[0];
      return target ? targetNameMap.get(target.referenceId) ?? null : null;
    }
    return null;
  }, [targets, targetNameMap]);

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

    return runs;
  }, [runData, filters.scenarioId, period]);

  // Group filtered runs by batch (for "none" grouping and pass/fail filtering)
  const batchRuns = useMemo(() => {
    const grouped = groupRunsByBatchId({ runs: filteredRuns });

    if (filters.passFailStatus === "pass") {
      return grouped.filter((b) => {
        const summary = computeBatchRunSummary({ batchRun: b });
        return summary.failedCount === 0 && summary.passedCount > 0;
      });
    }
    if (filters.passFailStatus === "fail") {
      return grouped.filter((b) => {
        const summary = computeBatchRunSummary({ batchRun: b });
        return summary.failedCount > 0;
      });
    }

    return grouped;
  }, [filteredRuns, filters.passFailStatus]);

  // Group filtered runs by scenario or target (when groupBy is not "none")
  const groups = useMemo(() => {
    if (groupBy === "none") return [];

    const grouped =
      groupBy === "scenario"
        ? groupRunsByScenarioId({ runs: filteredRuns })
        : groupRunsByTarget({ runs: filteredRuns, targetNameMap });

    if (filters.passFailStatus === "pass") {
      return grouped.filter((g) => {
        const summary = computeGroupSummary({ group: g });
        return summary.failedCount === 0 && summary.passedCount > 0;
      });
    }
    if (filters.passFailStatus === "fail") {
      return grouped.filter((g) => {
        const summary = computeGroupSummary({ group: g });
        return summary.failedCount > 0;
      });
    }

    return grouped;
  }, [groupBy, filteredRuns, targetNameMap, filters.passFailStatus]);

  // Auto-expand the most recent group when data first loads
  useEffect(() => {
    if (!hasAutoExpanded.current) {
      if (groupBy === "none" && batchRuns.length > 0) {
        const firstId = batchRuns[0]?.batchRunId;
        if (firstId) {
          setExpandedIds(new Set([firstId]));
          hasAutoExpanded.current = true;
        }
      } else if (groupBy !== "none" && groups.length > 0) {
        const firstId = groups[0]?.groupKey;
        if (firstId) {
          setExpandedIds(new Set([firstId]));
          hasAutoExpanded.current = true;
        }
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

  const handleScenarioRunClick = useCallback(
    (scenarioRun: ScenarioRunData) => {
      if (!project) return;
      const url = buildRoutePath("simulations_run", {
        project: project.slug,
        scenarioSetId: setId,
        batchRunId: scenarioRun.batchRunId,
        scenarioRunId: scenarioRun.scenarioRunId,
      });
      window.open(url, "_blank");
    },
    [project, setId],
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
        <Text fontSize="sm" color="fg.muted">
          Run this suite to see results here.
        </Text>
      </VStack>
    );
  }

  return (
    <VStack align="stretch" gap={0} flex={1}>
      {/* Last activity timestamp */}
      {lastActivityTimestamp && (
        <Box paddingX={6} paddingBottom={3}>
          <Text fontSize="xs" color="fg.muted">
            {formatTimeAgoCompact(lastActivityTimestamp)}
          </Text>
        </Box>
      )}

      {/* Filter bar with group-by selector */}
      <Box paddingX={6} paddingBottom={4}>
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={filters}
          onFiltersChange={handleFiltersChange}
          groupBy={groupBy}
          onGroupByChange={setGroupBy}
        />
      </Box>

      {/* Queue status banner */}
      {hasPendingJobs && (
        <Box paddingX={6} paddingBottom={3}>
          <QueueStatusBanner queueStatus={queueStatus} />
        </Box>
      )}

      {/* Run history rows */}
      <VStack align="stretch" gap={2} paddingX={6} flex={1} overflow="auto">
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
                  targetName={singleTargetName}
                  onScenarioRunClick={handleScenarioRunClick}
                  expectedJobCount={expectedJobCount}
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
                  targetName={singleTargetName}
                />
              );
            })}
      </VStack>

      {/* Footer */}
      <RunHistoryFooter totals={totals} />
    </VStack>
  );
}
