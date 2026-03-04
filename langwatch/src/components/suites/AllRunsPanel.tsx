/**
 * All Runs Panel - cross-suite view showing batch runs from all suites.
 *
 * Displays aggregated run history across all suites in the project.
 * Each batch run shows its suite name and all data is fetched via getAllSuiteRunData endpoint.
 */

import { Box, Button, Spinner, Text, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ViewMode } from "./useRunHistoryStore";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useTargetNameMap } from "~/hooks/useTargetNameMap";
import { api } from "~/utils/api";
import type { Period } from "~/components/PeriodSelector";
import {
  RunHistoryFilters,
  type RunHistoryFilterValues,
} from "./RunHistoryFilters";
import { RunHistoryFooter } from "./RunHistoryFooter";
import { RunRow } from "./RunRow";
import { extractSuiteId } from "~/server/suites/suite-set-id";
import {
  computeBatchRunSummary,
  computeRunHistoryTotals,
  groupRunsByBatchId,
} from "./run-history-transforms";

type AllRunsPanelProps = {
  period: Period;
};

export function AllRunsPanel({ period }: AllRunsPanelProps) {
  const { project } = useOrganizationTeamProject();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const hasAutoExpanded = useRef(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [filters, setFilters] = useState<RunHistoryFilterValues>({
    scenarioId: "",
    passFailStatus: "",
  });
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  // Reset pagination when period changes
  const startDateMs = period.startDate.getTime();
  const endDateMs = period.endDate.getTime();
  useEffect(() => {
    setCursor(undefined);
    setPages([]);
  }, [startDateMs, endDateMs]);

  // Accumulate pages for true "Load More" behavior
  type PageData = {
    runs: ScenarioRunData[];
    scenarioSetIds: Record<string, string>;
    hasMore: boolean;
    nextCursor?: string;
  };
  const [pages, setPages] = useState<PageData[]>([]);
  const prevCursorRef = useRef<string | undefined>(undefined);

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

  // Fetch cross-suite run data for current cursor
  const {
    data: runDataResult,
    isLoading,
    error,
  } = api.scenarios.getAllSuiteRunData.useQuery(
    {
      projectId: project?.id ?? "",
      limit: 20,
      cursor,
      startDate: startDateMs,
      endDate: endDateMs,
    },
    {
      enabled: !!project,
      refetchInterval: pages.length <= 1 ? 5000 : undefined, // Disable auto-refresh after Load More
    },
  );

  // Accumulate pages as data arrives
  useEffect(() => {
    if (!runDataResult) return;

    if (cursor === undefined) {
      // First page — replace all accumulated data
      setPages([runDataResult]);
    } else if (cursor !== prevCursorRef.current) {
      // New cursor — append page
      setPages((prev) => [...prev, runDataResult]);
    }
    prevCursorRef.current = cursor;
  }, [runDataResult, cursor]);

  // Flatten accumulated pages into a single dataset
  const allRuns = useMemo(() => {
    return pages.flatMap((p) => p.runs);
  }, [pages]);

  const allScenarioSetIds = useMemo(() => {
    const merged: Record<string, string> = {};
    for (const page of pages) {
      Object.assign(merged, page.scenarioSetIds);
    }
    return merged;
  }, [pages]);

  const hasMore = pages.length > 0 ? (pages[pages.length - 1]?.hasMore ?? false) : false;

  // Fetch all scenarios for filter options
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
        (r) => r.status === ScenarioRunStatus.ERROR || r.status === ScenarioRunStatus.FAILED,
      );
    } else if (filters.passFailStatus === "stalled") {
      runs = runs.filter((r) => r.status === ScenarioRunStatus.STALLED);
    }

    return runs;
  }, [allRuns, filters]);

  // Group filtered runs by batch
  const batchRuns = useMemo(() => {
    return groupRunsByBatchId({
      runs: filteredRuns,
      scenarioSetIds: allScenarioSetIds,
    });
  }, [filteredRuns, allScenarioSetIds]);

  // Auto-expand all rows when data first loads
  useEffect(() => {
    if (!hasAutoExpanded.current && batchRuns.length > 0) {
      setExpandedIds(new Set(batchRuns.map((b) => b.batchRunId)));
      hasAutoExpanded.current = true;
    }
  }, [batchRuns]);

  // Compute totals from flat filtered runs
  const totals = useMemo(() => {
    return computeRunHistoryTotals({ runs: filteredRuns });
  }, [filteredRuns]);

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

  const { openDrawer } = useDrawer();

  const handleScenarioRunClick = useCallback(
    (scenarioRun: ScenarioRunData) => {
      openDrawer("scenarioRunDetail", {
        urlParams: { scenarioRunId: scenarioRun.scenarioRunId },
      });
    },
    [openDrawer],
  );

  // Load more pagination — advance cursor to fetch next page
  const handleLoadMore = useCallback(() => {
    const lastPage = pages[pages.length - 1];
    if (lastPage?.nextCursor) {
      setCursor(lastPage.nextCursor);
    }
  }, [pages]);

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
          {batchRuns.length} {batchRuns.length === 1 ? "execution" : "executions"} · {totals.runCount}{" "}
          {totals.runCount === 1 ? "run" : "runs"}
        </Text>
      </Box>

      {/* Filters */}
      <RunHistoryFilters
        scenarioOptions={scenarioOptions}
        filters={filters}
        onFiltersChange={setFilters}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
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
              const suiteId = batchRun.scenarioSetId
                ? extractSuiteId(batchRun.scenarioSetId)
                : null;
              const suiteName = suiteId ? suiteNameMap.get(suiteId) ?? null : null;

              return (
                <RunRow
                  key={batchRun.batchRunId}
                  batchRun={batchRun}
                  summary={summary}
                  isExpanded={isExpanded}
                  onToggle={() => toggleExpanded(batchRun.batchRunId)}
                  resolveTargetName={resolveTargetName}
                  onScenarioRunClick={handleScenarioRunClick}
                  suiteName={suiteName ?? undefined}
                  viewMode={viewMode}
                />
              );
            })}
          </VStack>

          {/* Load More button */}
          {hasMore && (
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
