/** Main entry point combining the sidebar and table (V3-style, replaces BatchEvaluationV2). */

import { useDrawer } from "@langwatch/browser-host/drawer";
import type { UiHostProject } from "@langwatch/browser-host/use-organization-team-project";
import { useRouter } from "@langwatch/browser-host/use-router";
import { Alert, Box, Card, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import type React from "react";
import { useCallback, useMemo, useState } from "react";

import {
  RUN_COLORS,
  type RunWithColor,
  useMultiRunData,
} from "../../../behavior/batch-evaluation-results/use-multi-run-data.ts";
import { useShowComparisonLeaderboard } from "../../../behavior/batch-evaluation-results/use-show-comparison-leaderboard.ts";
import { experimentApi } from "../../../behavior/experiment-api.ts";
import { TraceIdPeek } from "../../../behavior/lent-trace.tsx";
import { useComparisonMode } from "../../../behavior/use-comparison-mode.ts";
import { useResultDisplayPreferences } from "../../../behavior/use-result-display-preferences.ts";
import { getRunDisplayName } from "../../../model/batch-evaluation-results.run-display-name.ts";
import { describeCellFailure } from "../../../model/cell-failure.ts";
import type { ExperimentRow } from "../../../model/experiment-api-map.ts";
import { TableSkeleton } from "../../elements/batch-results/table-skeleton.tsx";
import { EvaluatorResultChip } from "../../elements/evaluator/evaluator-result-chip.tsx";
import { downloadCsv } from "../batch-evaluation-results.csv.ts";
import {
  transformBatchEvaluationData,
  type BatchEvaluationData,
} from "../batch-evaluation-results.types.ts";
import {
  BatchEvaluationResultsTable,
  ColumnVisibilityButton,
  DEFAULT_HIDDEN_COLUMNS,
  FieldsButton,
  GroupRowsButton,
  RowHeightButton,
} from "../batch-results/batch-evaluation-results-table.tsx";
import { type BatchRunSummary, BatchRunsSidebar } from "../batch-results/batch-runs-sidebar.tsx";
import { ComparisonCharts } from "../batch-results/comparison-charts.tsx";
import {
  type RenderBatchEvaluatorResult,
  type RenderDatasetImage,
  type RenderTracePeek,
} from "../batch-results/presentation.tsx";
import { StoredObjectImage } from "../stored-object/stored-object-image.tsx";
import { useResultsGrouping } from "../use-results-grouping.ts";
import { BatchEvaluationResultsHeader } from "./batch-evaluation-results-header.tsx";

type BatchEvaluationResultsProps = {
  project?: UiHostProject;
  experiment?: ExperimentRow;
  /** Size variant */
  size?: "sm" | "md";
  /** External run ID selection (for controlled mode) */
  selectedRunId?: string;
  /** Callback when run selection changes (for controlled mode) */
  onSelectRunId?: (runId: string) => void;
};

type RouterQuery = Record<string, string | string[] | undefined>;

/**
 * The router query `groupBy` would produce, or `null` for a no-op (an
 * identical-query replace still costs a navigation and re-runs effects).
 */
const queryWithGroupBy = (query: RouterQuery, groupBy: string | null): RouterQuery | null => {
  if (groupBy) {
    if (query.groupBy === groupBy) return null;
    return { ...query, groupBy };
  }
  if (!("groupBy" in query)) return null;
  const { groupBy: _dropped, ...rest } = query;
  return rest;
};

/** Which result columns are hidden, starting from the defaults. */
const useColumnVisibility = () => {
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(
    () => new Set(DEFAULT_HIDDEN_COLUMNS),
  );
  const toggleColumn = useCallback((columnName: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (!next.delete(columnName)) next.add(columnName);
      return next;
    });
  }, []);
  return { hiddenColumns, toggleColumn };
};

/** The runs as the sidebar lists them. */
const sidebarRunsOf = (runs: BatchRunSummary[] | undefined): BatchRunSummary[] =>
  (runs ?? []).map((run) => ({
    runId: run.runId,
    workflowVersion: run.workflowVersion,
    timestamps: run.timestamps,
    progress: run.progress,
    total: run.total,
    summary: {
      datasetCost: run.summary.datasetCost,
      evaluationsCost: run.summary.evaluationsCost,
      evaluations: Object.fromEntries(
        Object.entries(run.summary.evaluations).map(([id, ev]) => [
          id,
          { name: ev.name, averageScore: ev.averageScore, averagePassed: ev.averagePassed },
        ]),
      ),
    },
  }));

/** Each run's name: its commit message, else "Run #N" numbered in creation order. */
const runNameMapOf = (runs: BatchRunSummary[]): Record<string, string | React.ReactNode> =>
  Object.fromEntries(
    runs
      .toSorted((a, b) => a.timestamps.createdAt - b.timestamps.createdAt)
      .map((run, index) => [
        run.runId,
        getRunDisplayName({
          commitMessage: run.workflowVersion?.commitMessage,
          runId: run.runId,
          index,
        }),
      ]),
  );

/** The `compare` query param's run ids, whichever shape the router gave it in. */
const compareRunIdsFromQuery = (param: unknown): string[] | undefined => {
  if (typeof param === "string") return param.split(",").filter(Boolean);
  if (Array.isArray(param)) return param.filter((id): id is string => typeof id === "string");
  return undefined;
};

/** The `groupBy` query param, or null when there is no grouping. */
const groupByFromQuery = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/**
 * The query after a comparison change: comparing two or more runs sets `compare` and
 * drops `runId`; leaving compare mode with none drops `compare`.
 */
const queryWithComparison = ({
  query,
  isComparing,
  comparedRunIds,
}: {
  query: Record<string, unknown>;
  isComparing: boolean;
  comparedRunIds: string[];
}): Record<string, unknown> => {
  if (isComparing && comparedRunIds.length >= 2) {
    const { runId: _runId, ...rest } = query;
    return { ...rest, compare: comparedRunIds.join(",") };
  }
  if (!isComparing && comparedRunIds.length === 0) {
    const { compare: _compare, ...rest } = query;
    return rest;
  }
  return query;
};

/** One color per run, by its position in the full list, so a comparison keeps them. */
const runColorMapOf = (runIds: string[]): Record<string, string> =>
  Object.fromEntries(runIds.map((runId, idx) => [runId, RUN_COLORS[idx % RUN_COLORS.length]!]));

/** Charts open visible when they become available; a later hide by the user sticks. */
const useChartsVisibility = (canShowCharts: boolean): [boolean, (visible: boolean) => void] => {
  const [chartsVisible, setChartsVisible] = useState(canShowCharts);
  const [chartsWereAvailable, setChartsWereAvailable] = useState(canShowCharts);
  if (canShowCharts !== chartsWereAvailable) {
    setChartsWereAvailable(canShowCharts);
    if (canShowCharts) setChartsVisible(true);
  }
  return [chartsVisible, setChartsVisible];
};

/** The compared runs as the table and charts read them. */
const comparisonDataOf = (
  runs: RunWithColor[],
  runNameMap: Record<string, string | React.ReactNode>,
) =>
  runs.map((run) => ({
    runId: run.runId,
    runName: runNameMap[run.runId] ?? run.runId,
    color: run.color,
    data: run.data ? transformBatchEvaluationData(run.data) : null,
    isLoading: run.isLoading,
  }));

/** The selected run's results. */
const useSelectedRunData = ({
  projectId,
  experimentId,
  selectedRunId,
}: {
  projectId?: string;
  experimentId?: string;
  selectedRunId: string | undefined;
}) => {
  const runDataQuery = experimentApi.experiments.getExperimentBatchEvaluationRun.useQuery(
    { projectId: projectId ?? "", experimentId: experimentId ?? "", runId: selectedRunId ?? "" },
    {
      enabled: !!projectId && !!experimentId && !!selectedRunId,
    },
  );
  const transformedData: BatchEvaluationData | null = useMemo(
    () => (runDataQuery.data ? transformBatchEvaluationData(runDataQuery.data) : null),
    [runDataQuery.data],
  );
  return { runDataQuery, transformedData };
};

/** The compared runs, synced to the URL's `compare` param unless a parent controls the page. */
const useComparisonUrlSync = ({ controlled }: { controlled: boolean }) => {
  const router = useRouter();
  const queryCompareRunIds = useMemo(
    () => compareRunIdsFromQuery(router.query.compare),
    [router.query.compare],
  );
  const handleComparisonChange = useCallback(
    (isComparing: boolean, comparedRunIds: string[]) => {
      if (controlled) return;
      const newQuery = queryWithComparison({ query: router.query, isComparing, comparedRunIds });
      if (router.query.compare === newQuery.compare) return;
      void router.replace(
        { pathname: router.pathname, query: newQuery },
        {
          shallow: true,
        },
      );
    },
    [controlled, router],
  );
  return { queryCompareRunIds, handleComparisonChange };
};

/** The run shown: the parent's choice, else the URL's, else the newest. */
const useRunSelection = ({
  externalSelectedRunId,
  firstRunId,
  onSelectRunId,
}: {
  externalSelectedRunId?: string;
  firstRunId?: string;
  onSelectRunId?: (runId: string) => void;
}) => {
  const router = useRouter();
  const queryRunId = typeof router.query.runId === "string" ? router.query.runId : undefined;
  const selectedRunId = externalSelectedRunId ?? queryRunId ?? firstRunId;
  const handleSelectRun = useCallback(
    (runId: string) => {
      if (onSelectRunId) return onSelectRunId(runId);
      void router.replace(
        { pathname: router.pathname, query: { ...router.query, runId } },
        { shallow: true },
      );
    },
    [onSelectRunId, router],
  );
  return { selectedRunId, handleSelectRun };
};

/**
 * Group-by-metadata, synced to the URL unless a parent controls the page. Applied
 * locally first, always: reading it back out of the URL put ~4s between the click
 * and the regroup. The URL stays the source of truth on load and in shared links.
 */
const useGroupBy = ({ controlled }: { controlled: boolean }) => {
  const router = useRouter();
  const queryGroupBy = useMemo(
    () => groupByFromQuery(router.query.groupBy),
    [router.query.groupBy],
  );
  const [localGroupBy, setLocalGroupBy] = useState<string | null>(null);
  const handleGroupByChange = useCallback(
    (next: string | null) => {
      setLocalGroupBy(next);
      if (controlled) return;
      const newQuery = queryWithGroupBy(router.query, next);
      if (!newQuery) return;
      void router.replace(
        { pathname: router.pathname, query: newQuery },
        {
          shallow: true,
        },
      );
    },
    [controlled, router],
  );
  return { groupBy: localGroupBy ?? queryGroupBy, handleGroupByChange };
};

const renderEvaluatorResult: RenderBatchEvaluatorResult = ({ result }) => (
  <EvaluatorResultChip
    name={result.evaluatorName}
    result={{
      status: result.status,
      score: result.score,
      passed: result.passed,
      label: result.label,
      details: result.details,
    }}
    inputs={result.inputs}
  />
);

const renderTracePeek: RenderTracePeek = ({ traceId }) => <TraceIdPeek traceId={traceId} />;

const renderDatasetImage: RenderDatasetImage = ({ src }) => (
  <StoredObjectImage
    src={src}
    minWidth="24px"
    minHeight="24px"
    maxHeight="80px"
    maxWidth="100%"
    expandable
  />
);

export function BatchEvaluationResults({
  project,
  experiment,
  size = "md",
  selectedRunId: externalSelectedRunId,
  onSelectRunId,
}: BatchEvaluationResultsProps) {
  const { openDrawer } = useDrawer();
  const showComparisonLeaderboard = useShowComparisonLeaderboard();

  const { hiddenColumns, toggleColumn } = useColumnVisibility();
  const { fields, toggleField, rowHeight, setRowHeight } = useResultDisplayPreferences();

  /** The experiment's runs, read as `BatchRunSummary` (what this file hands the sidebar). */
  const runsQuery = experimentApi.experiments.getExperimentBatchEvaluationRuns.useQuery(
    {
      projectId: project?.id ?? "",
      experimentId: experiment?.id ?? "",
    },
    {
      enabled: !!project && !!experiment,
    },
  ) as { data?: { runs: BatchRunSummary[] }; error?: unknown; isLoading: boolean };

  const { selectedRunId, handleSelectRun } = useRunSelection({
    externalSelectedRunId,
    firstRunId: runsQuery.data?.runs[0]?.runId,
    onSelectRunId,
  });

  const { runDataQuery, transformedData } = useSelectedRunData({
    projectId: project?.id,
    experimentId: experiment?.id,
    selectedRunId,
  });

  // Transform runs list for sidebar
  const sidebarRuns = useMemo(() => sidebarRunsOf(runsQuery.data?.runs), [runsQuery.data?.runs]);

  // Comparison mode
  const runIds = useMemo(() => sidebarRuns.map((r) => r.runId), [sidebarRuns]);

  // Map runId to human-readable name (commit message or "Run #N")
  // Sort chronologically so fallback "Run #N" numbering is stable
  const runNameMap = useMemo(() => runNameMapOf(sidebarRuns), [sidebarRuns]);

  const { groupBy, handleGroupByChange } = useGroupBy({ controlled: !!onSelectRunId });

  const { queryCompareRunIds, handleComparisonChange } = useComparisonUrlSync({
    controlled: !!onSelectRunId,
  });

  // Stable color map for ALL runs - colors are assigned based on position in the full list
  // This ensures colors stay the same regardless of which runs are selected for comparison
  const stableRunColorMap = useMemo(() => runColorMapOf(runIds), [runIds]);

  const {
    compareMode,
    selectedRunIds,
    toggleCompareMode,
    toggleRunSelection,
    enterCompareWithRuns,
  } = useComparisonMode({
    runIds,
    currentRunId: selectedRunId,
    initialCompareRunIds: queryCompareRunIds,
    onSelectionChange: handleComparisonChange,
  });

  // Fetch multiple runs when in compare mode
  const multiRunData = useMultiRunData({
    projectId: project?.id ?? "",
    experimentId: experiment?.id ?? "",
    runIds: selectedRunIds,
    enabled: compareMode && selectedRunIds.length > 0,
    runColorMap: stableRunColorMap,
  });

  // Transform comparison data for table
  const comparisonData = useMemo(
    () => (compareMode ? comparisonDataOf(multiRunData.runs, runNameMap) : null),
    [compareMode, multiRunData.runs, runNameMap],
  );

  // Determine if charts are available:
  // 1. In compare mode with 2+ runs selected
  // 2. Not in compare mode but with 2+ targets in single run
  const targetCount = transformedData?.targetColumns.length ?? 0;

  const canShowCharts = (compareMode && (comparisonData?.length ?? 0) >= 2) || targetCount >= 2;

  // Charts visibility state - default to visible when available
  const defaultChartsVisible = canShowCharts;

  const [chartsVisible, setChartsVisible] = useChartsVisibility(defaultChartsVisible);

  // Build chart data for single run (when not in compare mode but has 2+ targets)
  const singleRunChartData = useMemo(() => {
    if (compareMode || !transformedData || targetCount < 2) return null;
    // Create a "fake" comparison data with just this run
    return [
      {
        runId: transformedData.runId,
        runName: runNameMap[transformedData.runId] ?? transformedData.runId,
        color: stableRunColorMap[transformedData.runId] ?? RUN_COLORS[0],
        data: transformedData,
        isLoading: false,
      },
    ];
  }, [compareMode, transformedData, targetCount, stableRunColorMap, runNameMap]);

  // Chart data to display - either comparison data or single run data
  // Derived here so the toolbar button and the table agree on which keys
  // exist; ComparisonTable derives the same set for its own rendering.
  const { availableKeys: groupableKeys } = useResultsGrouping({
    source: "dataset-entry",
    comparisonData,
  });

  const chartDisplayData = compareMode ? comparisonData : singleRunChartData;

  // Target colors from charts (when X-axis is "target")
  const [targetColors, setTargetColors] = useState<Record<string, string>>({});

  // Run colors are now stable - use the stable map created above
  const runColors = stableRunColorMap;

  // Find sidebar run for selected
  const sidebarSelectedRun = sidebarRuns.find((r) => r.runId === selectedRunId);

  // CSV download - using the new V3 export that properly handles multi-target data
  const handleDownloadCSV = useCallback(() => {
    if (!transformedData || !experiment) return;
    downloadCsv(transformedData, experiment.name ?? experiment.slug);
  }, [transformedData, experiment]);

  const showRunsLoading = runsQuery.isLoading;
  const showWaitingForRuns = !showRunsLoading && sidebarRuns.length === 0;
  const showResultsTable = !showRunsLoading && sidebarRuns.length > 0;

  // Error state
  if (runsQuery.error) {
    return (
      <Alert.Root status="error">
        <Alert.Indicator />
        Error loading experiment runs
      </Alert.Root>
    );
  }

  return (
    <HStack align="stretch" width="full" height="full" gap={0} overflow="hidden">
      {/* Sidebar - fixed width, doesn't shrink */}
      <Box flexShrink={0}>
        <BatchRunsSidebar
          runs={sidebarRuns}
          selectedRunId={selectedRunId}
          onSelectRun={handleSelectRun}
          isLoading={runsQuery.isLoading}
          size={size}
          compareMode={compareMode}
          onToggleCompareMode={toggleCompareMode}
          selectedRunIds={selectedRunIds}
          onToggleRunSelection={toggleRunSelection}
          onEnterCompareWithRuns={enterCompareWithRuns}
          runColors={runColors}
        />
      </Box>

      {/* Main content - flex column that fills available space */}
      <VStack flex={1} minWidth={0} height="full" gap={0} align="stretch" overflow="auto">
        {/* Header - fixed height */}
        <BatchEvaluationResultsHeader
          project={project}
          experiment={experiment}
          shownRunId={sidebarSelectedRun?.runId}
          data={transformedData}
          charts={{ available: canShowCharts, visible: chartsVisible, onChange: setChartsVisible }}
          displayControls={
            <>
              <RowHeightButton value={rowHeight} onChange={setRowHeight} />
              <FieldsButton fields={fields} onToggle={toggleField} />
              <GroupRowsButton
                availableKeys={groupableKeys}
                value={groupBy}
                onChange={handleGroupByChange}
              />
            </>
          }
          columnControls={
            <ColumnVisibilityButton
              datasetColumns={transformedData?.datasetColumns ?? []}
              hiddenColumns={hiddenColumns}
              onToggle={toggleColumn}
            />
          }
          onDownloadCsv={handleDownloadCSV}
        />

        {/* Charts (comparison or single-run with multiple targets) - auto height.
            The win-rate chart lives INSIDE this component alongside
            Cost / Latency / (non-comparison) score charts, so the results
            header reads as one row of siblings rather than a stacked mixture. */}
        {canShowCharts && chartDisplayData && chartDisplayData.length > 0 && (
          <ComparisonCharts
            comparisonData={chartDisplayData}
            isVisible={chartsVisible}
            onVisibilityChange={setChartsVisible}
            onTargetColorsChange={setTargetColors}
            comparisonColumns={transformedData?.comparisonColumns}
            comparisonRows={transformedData?.rows}
            showComparisonLeaderboard={showComparisonLeaderboard}
            onOpenLeaderboard={(input) => openDrawer("comparisonLeaderboard", input)}
          />
        )}

        {/* Table container - fills remaining space */}
        {showRunsLoading && (
          <Box flex={1} minHeight="300px" overflow="auto" paddingX={2} paddingBottom={2}>
            <TableSkeleton withCard />
          </Box>
        )}
        {showWaitingForRuns && <Text padding={4}>Waiting for results...</Text>}
        {showResultsTable && (
          <Box flex={1} minHeight="300px" paddingX={2} paddingBottom={2}>
            <Card.Root width="100%" height="100%" overflow="hidden">
              <Card.Body padding={0} height="100%">
                <BatchEvaluationResultsTable
                  data={transformedData}
                  isLoading={runDataQuery.isLoading && !compareMode}
                  hiddenColumns={hiddenColumns}
                  onToggleColumn={toggleColumn}
                  comparisonData={comparisonData}
                  targetColors={targetColors}
                  showOutputs={fields.outputs}
                  showEvaluations={fields.scores}
                  showCostAndLatency={fields.costAndLatency}
                  rowHeight={rowHeight}
                  groupBy={groupBy}
                  describeFailure={describeCellFailure}
                  renderEvaluatorResult={renderEvaluatorResult}
                  renderTracePeek={renderTracePeek}
                  onOpenTrace={(traceId) => openDrawer("traceV2Details", { traceId })}
                  renderDatasetImage={renderDatasetImage}
                />
              </Card.Body>
            </Card.Root>
          </Box>
        )}
      </VStack>
    </HStack>
  );
}
