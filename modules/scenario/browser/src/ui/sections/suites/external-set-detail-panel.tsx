/**
 * Read-only detail panel for external SDK/CI scenario sets.
 */

import { useDrawer } from "@langwatch/browser-host/drawer";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { Box, Button, EmptyState, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { ScenarioRunStatus } from "@langwatch/scenario-contract";
import type { ScenarioRunData } from "@langwatch/scenario-contract";
import { FlaskConical, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { HandledErrorAlert } from "../../../behavior/errors.tsx";
import { scenarioContextChip } from "../../../behavior/langy/langy-context-chips.ts";
import { useScenarios } from "../../../behavior/scenarios/use-scenarios.ts";
import { useAutoExpansion } from "../../../behavior/suite/use-auto-expansion.ts";
import { useRunHistoryStore } from "../../../behavior/suite/use-run-history-store.ts";
import { useScrollToBatch } from "../../../behavior/suite/use-scroll-to-batch.ts";
import { usePrefetchRunState } from "../../../behavior/suites/use-prefetch-run-state.ts";
import { useSuiteRunData } from "../../../behavior/suites/use-suite-run-data.ts";
import { useSuiteRunFreshness } from "../../../behavior/suites/use-suite-run-freshness.ts";
import { useSimulationUpdateListener } from "../../../behavior/use-simulation-update-listener.ts";
import type { Period } from "../../../model/analytics/period.ts";
import {
  availableGroupByOptions,
  computeBatchRunSummary,
  computeGroupSummary,
  groupRunsByBatchId,
  groupRunsByScenarioId,
} from "../../../model/suite/run-history-transforms.ts";
import { ShadowDivider } from "../../elements/shadow-divider.tsx";
import { RunHistorySkeleton } from "../../elements/suite/runs/run-history-skeleton.tsx";
import { ScenarioTabConnectedBadge } from "../../elements/suite/runs/scenario-tab-connected-badge.tsx";
import { type ScenarioRunContextRenderer } from "../../elements/suite/runs/scenario-target-row.tsx";
import { LangyContextTarget } from "../langy/langy-context-target.tsx";
import { GroupRow } from "../suite/group-row.tsx";
import { RunHistoryFilters, type RunHistoryFilterValues } from "../suite/run-history-filters.tsx";
import { RunRow } from "../suite/run-row.tsx";

const renderScenarioContext: ScenarioRunContextRenderer = ({ scenarioRunId, name, children }) => (
  <LangyContextTarget target={scenarioContextChip({ scenarioId: scenarioRunId, name })}>
    {children}
  </LangyContextTarget>
);

type ExternalSetDetailPanelProps = {
  scenarioSetId: string;
  period: Period;
  highlightBatchId?: string | null;
  /** True when the SDK opened this tab, so new local runs land here. */
  connectedToLocalRun?: boolean;
};

/** Group-by options available for external sets (no target). */
const EXTERNAL_GROUP_BY_OPTIONS = availableGroupByOptions({
  viewContext: "external",
});

function buildScenarioOptions(
  scenarios: { id: string; name: string }[] | undefined,
  runs: ScenarioRunData[] | undefined,
) {
  if (!scenarios || !runs) return [];
  const scenarioIds = new Set(runs.map((run) => run.scenarioId));
  return scenarios
    .filter((scenario) => scenarioIds.has(scenario.id))
    .map((scenario) => ({ id: scenario.id, name: scenario.name }));
}

function filterExternalRuns(
  runData: ScenarioRunData[] | undefined,
  filters: RunHistoryFilterValues,
): ScenarioRunData[] {
  if (!runData) return [];
  let runs = runData;
  if (filters.scenarioId) {
    runs = runs.filter((run) => run.scenarioId === filters.scenarioId);
  }
  if (filters.passFailStatus === "pass") {
    return runs.filter((run) => run.status === ScenarioRunStatus.SUCCESS);
  }
  if (filters.passFailStatus === "fail") {
    return runs.filter(
      (run) => run.status === ScenarioRunStatus.ERROR || run.status === ScenarioRunStatus.FAILED,
    );
  }
  if (filters.passFailStatus === "stalled") {
    return runs.filter((run) => run.status === ScenarioRunStatus.STALLED);
  }
  return runs;
}

export function ExternalSetDetailPanel({
  scenarioSetId,
  period,
  highlightBatchId,
  connectedToLocalRun = false,
}: ExternalSetDetailPanelProps) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const { openDrawer } = useDrawer();
  const prefetchRunState = usePrefetchRunState();
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
  const effectiveGroupBy = EXTERNAL_GROUP_BY_OPTIONS.includes(groupBy) ? groupBy : "none";

  // Live updates: SSE invalidates getSuiteRunData directly; its connection
  // state disables the fallback freshness polling below.
  const { isConnected: sseConnected } = useSimulationUpdateListener({
    projectId,
    enabled: !!projectId,
    debounceMs: 500,
    filter: { scenarioSetId },
  });

  const {
    data: runDataResult,
    isLoading,
    error,
    refetch,
  } = useSuiteRunData({
    input: {
      projectId,
      scenarioSetId,
      limit: 100,
      startDate: period.startDate.epochMilliseconds,
      endDate: period.endDate.epochMilliseconds,
    },
    enabled: !!project,
  });

  const runData = runDataResult && "runs" in runDataResult ? runDataResult.runs : undefined;

  useSuiteRunFreshness({
    scenarioSetId,
    startDateMs: period.startDate.epochMilliseconds,
    endDateMs: period.endDate.epochMilliseconds,
    runs: runData ?? [],
    enabled: !!project,
    sseConnected,
  });

  // Fetch scenarios for filter options
  const { data: scenarios } = useScenarios({ projectId });

  // Build scenario options for filter dropdown
  const scenarioOptions = useMemo(
    () => buildScenarioOptions(scenarios, runData),
    [scenarios, runData],
  );

  // Clamp scenarioId filter to valid options for this external set
  useEffect(() => {
    if (!filters.scenarioId || scenarioOptions.length === 0) return;
    const validIds = new Set(scenarioOptions.map((s) => s.id));
    if (!validIds.has(filters.scenarioId)) {
      setFilters({ ...filters, scenarioId: "" });
    }
  }, [filters, scenarioOptions, setFilters]);

  // Apply filters to raw run data
  const filteredRuns = useMemo(() => filterExternalRuns(runData, filters), [runData, filters]);

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

  const hasData = effectiveGroupBy === "none" ? batchRuns.length > 0 : groups.length > 0;
  const hasActiveFilters = !!(filters.scenarioId || filters.passFailStatus);

  const hasRuns = Boolean(runData && runData.length > 0);
  const showRuns = !isLoading && !error && hasRuns;
  const showEmpty = !isLoading && !error && !hasRuns;

  return (
    <VStack align="stretch" gap={0} height="100%">
      {/* Header */}
      <HStack paddingX={6} paddingY={4} justify="space-between">
        <VStack align="start" gap={0}>
          <Text fontSize="xs" fontWeight="bold" color="fg.muted" letterSpacing="wider">
            EXTERNAL SET
          </Text>
          <Text fontSize="lg" fontWeight="semibold">
            {scenarioSetId}
          </Text>
        </VStack>
        <ScenarioTabConnectedBadge visible={connectedToLocalRun} />
      </HStack>

      {/* Filter bar — fixed above the scrollable run list */}
      {showRuns && (
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

        {/* The alert is this panel's whole error surface: one component that
            reads the handled payload, an authored non-5xx message, or the
            generic unknown state, and carries the tips, docs link and
            copyable error id with it. */}
        {error && (
          <EmptyState.Root paddingY={12}>
            <EmptyState.Content>
              <Box maxWidth="420px" width="100%">
                <HandledErrorAlert error={error} fallbackTitle="Couldn't load run data" />
              </Box>
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                <RefreshCw size={14} /> Try again
              </Button>
            </EmptyState.Content>
          </EmptyState.Root>
        )}

        {showRuns && (
          <>
            {/* Run rows */}
            {!hasData && hasActiveFilters ? (
              <Box paddingX={6} paddingY={8} textAlign="center">
                <Text color="fg.muted">No runs match the selected filters.</Text>
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
                          isHighlighted={highlightedBatchId === batchRun.batchRunId}
                          onPrefetchRun={prefetchRunState}
                          renderScenarioContext={renderScenarioContext}
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
                          onPrefetchRun={prefetchRunState}
                          renderScenarioContext={renderScenarioContext}
                        />
                      );
                    })}
              </>
            )}
          </>
        )}

        {showEmpty && (
          <EmptyState.Root paddingY={12}>
            <EmptyState.Content>
              <EmptyState.Indicator>
                <FlaskConical size={28} />
              </EmptyState.Indicator>
              <EmptyState.Title>No runs yet</EmptyState.Title>
              <EmptyState.Description>No run data found for this set.</EmptyState.Description>
            </EmptyState.Content>
          </EmptyState.Root>
        )}
      </VStack>
    </VStack>
  );
}
