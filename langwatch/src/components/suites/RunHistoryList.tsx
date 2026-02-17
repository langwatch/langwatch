/**
 * Run history list for a suite.
 *
 * Fetches run data from ElasticSearch via the existing scenarioEvents tRPC endpoint,
 * groups results by batch run, and renders collapsible run rows with filters and footer.
 *
 * Uses the suite's setId (__internal__<suiteId>__suite) to query the scenario events.
 */

import { Box, Spinner, Text, VStack } from "@chakra-ui/react";
import type { SimulationSuite } from "@prisma/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { parseSuiteTargets } from "~/server/suites/types";
import { getSuiteSetId } from "~/server/suites/suite-set-id";
import { api } from "~/utils/api";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { buildRoutePath } from "~/utils/routes";
import {
  RunHistoryFilters,
  type RunHistoryFilterValues,
} from "./RunHistoryFilters";
import { RunHistoryFooter } from "./RunHistoryFooter";
import { RunRow } from "./RunRow";
import { QueueStatusBanner } from "./QueueStatusBanner";
import {
  computeBatchRunSummary,
  computeRunHistoryTotals,
  groupRunsByBatchId,
} from "./run-history-transforms";

export type RunHistoryStats = {
  runCount: number;
  passRate: number;
  lastActivityTimestamp: number | null;
};

type RunHistoryListProps = {
  suite: SimulationSuite;
  onStatsReady?: (stats: RunHistoryStats) => void;
};

export function RunHistoryList({ suite, onStatsReady }: RunHistoryListProps) {
  const { project } = useOrganizationTeamProject();
  const setId = getSuiteSetId(suite.id);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const hasAutoExpanded = useRef(false);
  const [filters, setFilters] = useState<RunHistoryFilterValues>({
    scenarioId: "",
    passFailStatus: "",
  });

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

  // Fetch run data using existing scenario events endpoint
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

  // Group runs by batch and apply filters
  const batchRuns = useMemo(() => {
    if (!runData) return [];

    let runs = runData;

    // Filter by scenario
    if (filters.scenarioId) {
      runs = runs.filter((r) => r.scenarioId === filters.scenarioId);
    }

    const grouped = groupRunsByBatchId({ runs });

    // Filter by pass/fail
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
  }, [runData, filters]);

  // Auto-expand the most recent run when data first loads
  useEffect(() => {
    if (!hasAutoExpanded.current && batchRuns.length > 0) {
      const firstId = batchRuns[0]?.batchRunId;
      if (firstId) {
        setExpandedIds(new Set([firstId]));
        hasAutoExpanded.current = true;
      }
    }
  }, [batchRuns]);

  const totals = useMemo(
    () => computeRunHistoryTotals({ batchRuns }),
    [batchRuns],
  );

  const lastActivityTimestamp = batchRuns[0]?.timestamp ?? null;

  // Notify parent when stats are ready
  useEffect(() => {
    if (onStatsReady) {
      const totalRunCount = batchRuns.reduce(
        (sum, batch) => sum + batch.scenarioRuns.length,
        0,
      );
      const finishedCount = totals.passedCount + totals.failedCount;
      const passRate = finishedCount > 0 ? (totals.passedCount / finishedCount) * 100 : 0;

      onStatsReady({
        runCount: totalRunCount,
        passRate,
        lastActivityTimestamp,
      });
    }
  }, [batchRuns, totals, lastActivityTimestamp, onStatsReady]);

  const handleToggle = useCallback((batchRunId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(batchRunId)) {
        next.delete(batchRunId);
      } else {
        next.add(batchRunId);
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
            {formatTimeAgo(lastActivityTimestamp)}
          </Text>
        </Box>
      )}

      {/* Filter bar */}
      <Box paddingX={6} paddingBottom={4}>
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={filters}
          onFiltersChange={setFilters}
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
        {batchRuns.map((batchRun) => {
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
        })}
      </VStack>

      {/* Footer */}
      <RunHistoryFooter totals={totals} />
    </VStack>
  );
}
