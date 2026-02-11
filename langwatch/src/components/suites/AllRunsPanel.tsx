/**
 * All Runs Panel - cross-suite view showing batch runs from all suites.
 *
 * Displays aggregated run history across all suites in the project.
 * Each batch run shows its suite name and all data is fetched via getAllSuiteRunData endpoint.
 */

import { Box, Button, Spinner, Text, VStack } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useCallback, useMemo, useState } from "react";
import type { ScenarioRunData } from "~/app/api/scenario-events/[[...route]]/types";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import {
  RunHistoryFilters,
  type RunHistoryFilterValues,
} from "./RunHistoryFilters";
import { RunHistoryFooter } from "./RunHistoryFooter";
import { RunRow } from "./RunRow";
import {
  computeBatchRunSummary,
  computeRunHistoryTotals,
  groupRunsByBatchIdWithSetIds,
} from "./run-history-transforms";

const SUITE_PREFIX = "__suite__";

export function AllRunsPanel() {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<RunHistoryFilterValues>({
    scenarioId: "",
    passFailStatus: "",
  });
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  // Fetch all suites to build suite name map
  const { data: suites } = api.suites.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );

  // Build suiteId → suite name map
  const suiteNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (suites) {
      for (const suite of suites) {
        map.set(suite.id, suite.name);
      }
    }
    return map;
  }, [suites]);

  // Fetch cross-suite run data
  const {
    data: runDataResult,
    isLoading,
    error,
  } = api.scenarios.getAllSuiteRunData.useQuery(
    {
      projectId: project?.id ?? "",
      limit: 20,
      cursor,
    },
    {
      enabled: !!project,
      refetchInterval: 5000,
    },
  );

  // Fetch all scenarios for filter options
  const { data: scenarios } = api.scenarios.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );


  // Build scenario options for filter dropdown
  const scenarioOptions = useMemo(() => {
    if (!scenarios) return [];
    return scenarios.map((s) => ({ id: s.id, name: s.name }));
  }, [scenarios]);

  // Group runs by batch and apply filters
  const batchRuns = useMemo(() => {
    if (!runDataResult) return [];

    let runs = runDataResult.runs;

    // Filter by scenario
    if (filters.scenarioId) {
      runs = runs.filter((r) => r.scenarioId === filters.scenarioId);
    }

    // Filter by pass/fail status
    if (filters.passFailStatus === "pass") {
      runs = runs.filter((r) => r.status === "SUCCESS");
    } else if (filters.passFailStatus === "fail") {
      runs = runs.filter(
        (r) => r.status === "ERROR" || r.status === "FAILED",
      );
    }

    return groupRunsByBatchIdWithSetIds({
      runs,
      scenarioSetIds: runDataResult.scenarioSetIds,
    });
  }, [runDataResult, filters]);

  // Compute totals
  const totals = useMemo(() => {
    return computeRunHistoryTotals({ batchRuns });
  }, [batchRuns]);

  // Get single run count across all batches
  const totalRunCount = useMemo(() => {
    return batchRuns.reduce(
      (sum, batch) => sum + batch.scenarioRuns.length,
      0,
    );
  }, [batchRuns]);

  // Toggle batch expansion
  const toggleExpanded = useCallback((batchRunId: string) => {
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

  // Navigate to run detail
  const handleScenarioRunClick = useCallback(
    (scenarioRun: ScenarioRunData) => {
      void router.push(
        `/${project?.slug}/scenarios/${scenarioRun.scenarioId}/runs/${scenarioRun.scenarioRunId}`,
      );
    },
    [project, router],
  );

  // Load more pagination
  const handleLoadMore = useCallback(() => {
    if (runDataResult?.nextCursor) {
      setCursor(runDataResult.nextCursor);
    }
  }, [runDataResult]);

  if (error) {
    return (
      <Box padding={6}>
        <Text color="red.600">Error loading runs: {error.message}</Text>
      </Box>
    );
  }

  if (isLoading && !runDataResult) {
    return (
      <Box padding={6} display="flex" justifyContent="center">
        <Spinner size="lg" />
      </Box>
    );
  }

  return (
    <VStack align="stretch" gap={4} height="100%" overflow="auto" paddingX={6} paddingY={4}>
      {/* Header */}
      <Box>
        <Text fontSize="xl" fontWeight="bold">
          All Runs
        </Text>
        <Text fontSize="sm" color="fg.muted">
          {totals.runCount} {totals.runCount === 1 ? "execution" : "executions"} · {totalRunCount}{" "}
          {totalRunCount === 1 ? "run" : "runs"}
        </Text>
      </Box>

      {/* Filters */}
      <RunHistoryFilters
        scenarioOptions={scenarioOptions}
        filters={filters}
        onFiltersChange={setFilters}
      />

      {/* Run list */}
      {batchRuns.length === 0 ? (
        <Box paddingY={8} textAlign="center">
          <Text color="fg.muted">
            {filters.scenarioId || filters.passFailStatus
              ? "No runs match the selected filters."
              : "No runs yet. Execute a suite to see results here."}
          </Text>
        </Box>
      ) : (
        <>
          <VStack align="stretch" gap={3}>
            {batchRuns.map((batchRun) => {
              const summary = computeBatchRunSummary({ batchRun });
              const isExpanded = expandedIds.has(batchRun.batchRunId);

              // Extract suite name from scenarioSetId
              const suiteId = batchRun.scenarioSetId?.startsWith(SUITE_PREFIX)
                ? batchRun.scenarioSetId.slice(SUITE_PREFIX.length)
                : null;
              const suiteName = suiteId ? suiteNameMap.get(suiteId) ?? null : null;

              // For targets, we can't determine a single target for cross-suite view
              // since each batch could have different targets. Use null for now.
              const targetName = null;

              return (
                <RunRow
                  key={batchRun.batchRunId}
                  batchRun={batchRun}
                  summary={summary}
                  isExpanded={isExpanded}
                  onToggle={() => toggleExpanded(batchRun.batchRunId)}
                  targetName={targetName}
                  onScenarioRunClick={handleScenarioRunClick}
                  suiteName={suiteName ?? undefined}
                />
              );
            })}
          </VStack>

          {/* Load More button */}
          {runDataResult?.hasMore && (
            <Box paddingTop={4} display="flex" justifyContent="center">
              <Button variant="outline" onClick={handleLoadMore}>
                Load More...
              </Button>
            </Box>
          )}
        </>
      )}

      {/* Footer */}
      <RunHistoryFooter totals={totals} />
    </VStack>
  );
}
