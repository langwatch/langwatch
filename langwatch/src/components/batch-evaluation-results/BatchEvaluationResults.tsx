/**
 * BatchEvaluationResults - Main wrapper component for batch evaluation results
 *
 * This is the main entry point that combines the sidebar and table.
 * It replaces BatchEvaluationV2 with a cleaner, V3-style visualization.
 */

import {
  Alert,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { type Experiment, ExperimentType, type Project } from "@prisma/client";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart2, Download, ExternalLink } from "react-feather";

import { Link } from "~/components/ui/link";
import { api } from "~/utils/api";
import { PageLayout } from "../ui/layouts/PageLayout";
import {
  BatchEvaluationResultsTable,
  ColumnVisibilityButton,
  DEFAULT_HIDDEN_COLUMNS,
} from "./BatchEvaluationResultsTable";
import { type BatchRunSummary, BatchRunsSidebar } from "./BatchRunsSidebar";
import { ComparisonCharts, type XAxisOption } from "./ComparisonCharts";
import { downloadCsv } from "./csvExport";
import { TableSkeleton } from "./TableSkeleton";
import {
  type BatchEvaluationData,
  transformBatchEvaluationData,
} from "./types";
import { useComparisonMode } from "./useComparisonMode";
import {
  RUN_COLORS,
  type RunWithColor,
  useMultiRunData,
} from "./useMultiRunData";

type BatchEvaluationResultsProps = {
  project: Project;
  experiment: Experiment;
  /** Size variant */
  size?: "sm" | "md";
  /** External run ID selection (for controlled mode) */
  selectedRunId?: string;
  /** Callback when run selection changes (for controlled mode) */
  onSelectRunId?: (runId: string) => void;
};

/** Time in milliseconds after which a run without updates is considered interrupted */
const INTERRUPTED_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check if a run is finished based on timestamps
 * A run is considered finished if it has finished_at, stopped_at,
 * or hasn't been updated in 5 minutes (interrupted)
 */
const isRunFinished = (timestamps: {
  finished_at?: number | null;
  stopped_at?: number | null;
  updated_at?: number;
}): boolean => {
  // Explicitly finished or stopped
  if (timestamps.finished_at ?? timestamps.stopped_at) {
    return true;
  }

  // Consider interrupted if no updates for 5 minutes
  if (timestamps.updated_at) {
    const timeSinceUpdate = Date.now() - timestamps.updated_at;
    if (timeSinceUpdate > INTERRUPTED_THRESHOLD_MS) {
      return true;
    }
  }

  return false;
};

/** Grace period after run finishes to continue refetching for final results */
const REFETCH_GRACE_PERIOD_MS = 3000; // 3 seconds

export function BatchEvaluationResults({
  project,
  experiment,
  size = "md",
  selectedRunId: externalSelectedRunId,
  onSelectRunId,
}: BatchEvaluationResultsProps) {
  // Track if any run is still in progress
  const [isSomeRunning, setIsSomeRunning] = useState(false);

  // Track when the selected run finished (for grace period)
  const [finishedAt, setFinishedAt] = useState<number | null>(null);

  // Column visibility state - initialize with defaults
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(
    () => new Set(DEFAULT_HIDDEN_COLUMNS),
  );

  // Toggle column visibility
  const toggleColumn = useCallback((columnName: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(columnName)) {
        next.delete(columnName);
      } else {
        next.add(columnName);
      }
      return next;
    });
  }, []);

  // Fetch runs list
  const runsQuery = api.experiments.getExperimentBatchEvaluationRuns.useQuery(
    {
      projectId: project.id,
      experimentId: experiment.id,
    },
    {
      refetchInterval: isSomeRunning ? 3000 : 10000,
    },
  );

  // Router for URL query params
  const router = useRouter();

  // Get runId from URL query params
  const queryRunId =
    typeof router.query.runId === "string" ? router.query.runId : undefined;

  // Determine which run ID to use (priority: external prop > URL query > first run)
  const selectedRunId =
    externalSelectedRunId ?? queryRunId ?? runsQuery.data?.runs[0]?.run_id;

  // Handle run selection - updates URL query param
  const handleSelectRun = useCallback(
    (runId: string) => {
      if (onSelectRunId) {
        onSelectRunId(runId);
      } else {
        // Update URL query param without full navigation
        void router.replace(
          {
            pathname: router.pathname,
            query: { ...router.query, runId },
          },
          undefined,
          { shallow: true },
        );
      }
    },
    [onSelectRunId, router],
  );

  // Find selected run
  const selectedRun = useMemo(
    () => runsQuery.data?.runs.find((r) => r.run_id === selectedRunId),
    [runsQuery.data?.runs, selectedRunId],
  );

  // Determine if selected run is finished
  const isFinished = useMemo(() => {
    if (!selectedRun) return false;
    return isRunFinished(selectedRun.timestamps);
  }, [selectedRun]);

  // Track when the run finished and reset when run changes or becomes not finished
  useEffect(() => {
    if (isFinished && finishedAt === null) {
      // Run just finished, record the time
      setFinishedAt(Date.now());
    } else if (!isFinished) {
      // Run is not finished (new run or restarted), reset
      setFinishedAt(null);
    }
  }, [isFinished, finishedAt]);

  // Reset finishedAt when selected run changes
  useEffect(() => {
    setFinishedAt(null);
  }, [selectedRunId]);

  // Force re-render after grace period expires to stop refetching
  useEffect(() => {
    if (finishedAt === null) return;

    const timeUntilGraceExpires =
      REFETCH_GRACE_PERIOD_MS - (Date.now() - finishedAt);
    if (timeUntilGraceExpires <= 0) return;

    const timer = setTimeout(() => {
      // Force re-render by setting finishedAt to a new value (same time but new reference won't work since it's a number)
      // Instead, we set it to -1 to indicate grace period has expired
      setFinishedAt(-1);
    }, timeUntilGraceExpires);

    return () => clearTimeout(timer);
  }, [finishedAt]);

  // Determine if we're still in the grace period after finish
  // finishedAt > 0 means we have a valid timestamp, and we check if it's within grace period
  const isInGracePeriod =
    isFinished &&
    finishedAt !== null &&
    finishedAt > 0 &&
    Date.now() - finishedAt < REFETCH_GRACE_PERIOD_MS;

  // Update isSomeRunning state
  useEffect(() => {
    const hasRunning = runsQuery.data?.runs.some(
      (r) => !isRunFinished(r.timestamps),
    );
    setIsSomeRunning(!!hasRunning);
  }, [runsQuery.data?.runs]);

  // Determine refetch interval for run data
  // - 1000ms while running
  // - 1000ms during grace period after finish (to catch final results)
  // - false (disabled) after grace period
  const runDataRefetchInterval = !isFinished || isInGracePeriod ? 1000 : false;

  // Fetch selected run data
  const runDataQuery = api.experiments.getExperimentBatchEvaluationRun.useQuery(
    {
      projectId: project.id,
      experimentId: experiment.id,
      runId: selectedRunId ?? "",
    },
    {
      enabled: !!selectedRunId,
      refetchInterval: runDataRefetchInterval,
    },
  );

  // Transform run data
  const transformedData: BatchEvaluationData | null = useMemo(() => {
    if (!runDataQuery.data) return null;
    return transformBatchEvaluationData(runDataQuery.data);
  }, [runDataQuery.data]);

  // Transform runs list for sidebar
  const sidebarRuns: BatchRunSummary[] = useMemo(() => {
    if (!runsQuery.data?.runs) return [];
    return runsQuery.data.runs.map((run) => ({
      runId: run.run_id,
      workflowVersion: run.workflow_version,
      timestamps: run.timestamps,
      progress: run.progress,
      total: run.total,
      summary: {
        datasetCost: run.summary.dataset_cost,
        evaluationsCost: run.summary.evaluations_cost,
        evaluations: Object.fromEntries(
          Object.entries(run.summary.evaluations).map(([id, ev]) => [
            id,
            {
              name: ev.name,
              averageScore: ev.average_score,
              averagePassed: ev.average_passed,
            },
          ]),
        ),
      },
    }));
  }, [runsQuery.data?.runs]);

  // Comparison mode
  const runIds = useMemo(() => sidebarRuns.map((r) => r.runId), [sidebarRuns]);

  // Map runId to human-readable name (commit message or runId)
  const runNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const run of sidebarRuns) {
      map[run.runId] = run.workflowVersion?.commitMessage ?? run.runId;
    }
    return map;
  }, [sidebarRuns]);

  // Get compare run IDs from URL query params
  const queryCompareRunIds = useMemo(() => {
    const compareParam = router.query.compare;
    if (typeof compareParam === "string") {
      return compareParam.split(",").filter(Boolean);
    }
    if (Array.isArray(compareParam)) {
      return compareParam.filter((id): id is string => typeof id === "string");
    }
    return undefined;
  }, [router.query.compare]);

  // Handle comparison mode URL sync
  const handleComparisonChange = useCallback(
    (isComparing: boolean, comparedRunIds: string[]) => {
      if (onSelectRunId) return; // Don't sync URL in controlled mode

      const newQuery = { ...router.query };

      if (isComparing && comparedRunIds.length >= 2) {
        // In compare mode: set compare param, remove runId
        newQuery.compare = comparedRunIds.join(",");
        delete newQuery.runId;
      } else if (!isComparing && comparedRunIds.length === 0) {
        // Not in compare mode: remove compare param
        delete newQuery.compare;
      }

      // Only update if query actually changed
      const currentCompare = router.query.compare;
      const newCompare = newQuery.compare;
      if (currentCompare !== newCompare) {
        void router.replace(
          { pathname: router.pathname, query: newQuery },
          undefined,
          { shallow: true },
        );
      }
    },
    [onSelectRunId, router],
  );

  // Stable color map for ALL runs - colors are assigned based on position in the full list
  // This ensures colors stay the same regardless of which runs are selected for comparison
  const stableRunColorMap = useMemo(() => {
    const colorMap: Record<string, string> = {};
    runIds.forEach((runId, idx) => {
      colorMap[runId] = RUN_COLORS[idx % RUN_COLORS.length]!;
    });
    return colorMap;
  }, [runIds]);

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
    projectId: project.id,
    experimentId: experiment.id,
    runIds: selectedRunIds,
    enabled: compareMode && selectedRunIds.length > 0,
    runColorMap: stableRunColorMap,
  });

  // Transform comparison data for table
  const comparisonData = useMemo(() => {
    if (!compareMode) return null;
    return multiRunData.runs.map((run) => ({
      runId: run.runId,
      runName: runNameMap[run.runId] ?? run.runId,
      color: run.color,
      data: run.data ? transformBatchEvaluationData(run.data) : null,
      isLoading: run.isLoading,
    }));
  }, [compareMode, multiRunData.runs, runNameMap]);

  // Determine if charts are available:
  // 1. In compare mode with 2+ runs selected
  // 2. Not in compare mode but with 2+ targets in single run
  const targetCount = transformedData?.targetColumns.length ?? 0;
  const canShowCharts =
    (compareMode && (comparisonData?.length ?? 0) >= 2) || targetCount >= 2;

  // Charts visibility state - default to visible when available
  const defaultChartsVisible = canShowCharts;

  const [chartsVisible, setChartsVisible] = useState(defaultChartsVisible);

  // Update charts visibility when charts become available/unavailable
  useEffect(() => {
    if (canShowCharts && !chartsVisible) {
      setChartsVisible(true);
    }
  }, [canShowCharts]);

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
  }, [
    compareMode,
    transformedData,
    targetCount,
    stableRunColorMap,
    runNameMap,
  ]);

  // Chart data to display - either comparison data or single run data
  const chartDisplayData = compareMode ? comparisonData : singleRunChartData;

  // Target colors from charts (when X-axis is "target")
  const [targetColors, setTargetColors] = useState<Record<string, string>>({});

  // Run colors are now stable - use the stable map created above
  const runColors = stableRunColorMap;

  // Find sidebar run for selected
  const _sidebarSelectedRun = sidebarRuns.find(
    (r) => r.runId === selectedRunId,
  );

  // CSV download - using the new V3 export that properly handles multi-target data
  const handleDownloadCSV = useCallback(() => {
    if (!transformedData) return;
    downloadCsv(transformedData, experiment.name ?? experiment.slug);
  }, [transformedData, experiment.name, experiment.slug]);

  const isDownloadCSVEnabled =
    !!transformedData && transformedData.rows.length > 0;

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
    <HStack
      align="stretch"
      width="full"
      height="full"
      gap={0}
      overflow="hidden"
    >
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
      <VStack flex={1} minWidth={0} height="full" gap={0} align="stretch">
        {/* Header - fixed height */}
        <PageLayout.Header paddingX={2} withBorder={false} flexShrink={0}>
          <Heading>{experiment.name ?? experiment.slug}</Heading>
          <Spacer />
          {/* Charts toggle - show when charts are available */}
          {canShowCharts && (
            <Button
              size="sm"
              variant={chartsVisible ? "solid" : "outline"}
              onClick={() => setChartsVisible(!chartsVisible)}
              data-testid="toggle-charts-button"
            >
              <BarChart2 size={16} />
              Charts
            </Button>
          )}
          {transformedData && transformedData.datasetColumns.length > 0 && (
            <ColumnVisibilityButton
              datasetColumns={transformedData.datasetColumns}
              hiddenColumns={hiddenColumns}
              onToggle={toggleColumn}
            />
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleDownloadCSV}
            disabled={!isDownloadCSVEnabled}
          >
            <Download size={16} /> Export to CSV
          </Button>
          {experiment.workflowId && (
            <Link
              target="_blank"
              href={`/${project.slug}/studio/${experiment.workflowId}`}
              asChild
            >
              <Button size="sm" variant="outline" textDecoration="none">
                <ExternalLink size={16} /> Open Workflow
              </Button>
            </Link>
          )}
          {experiment.type === ExperimentType.EVALUATIONS_V3 && (
            <Link
              href={`/${project.slug}/evaluations/v3/${experiment.slug}`}
              asChild
            >
              <Button size="sm" variant="outline" textDecoration="none">
                <ExternalLink size={16} /> Open Evaluation
              </Button>
            </Link>
          )}
        </PageLayout.Header>

        {/* Charts (comparison or single-run with multiple targets) - auto height */}
        {canShowCharts && chartDisplayData && chartDisplayData.length > 0 && (
          <ComparisonCharts
            comparisonData={chartDisplayData}
            isVisible={chartsVisible}
            onVisibilityChange={setChartsVisible}
            onTargetColorsChange={setTargetColors}
          />
        )}

        {/* Table container - fills remaining space */}
        {runsQuery.isLoading ? (
          <Box
            flex={1}
            minHeight={0}
            overflow="auto"
            paddingRight={2}
            paddingBottom={2}
          >
            <TableSkeleton withCard />
          </Box>
        ) : sidebarRuns.length === 0 ? (
          <Text padding={4}>Waiting for results...</Text>
        ) : (
          <Box flex={1} minHeight={0} paddingRight={2} paddingBottom={2}>
            <Card.Root width="100%" height="100%" overflow="hidden">
              <Card.Body padding={0} height="100%">
                <BatchEvaluationResultsTable
                  data={transformedData}
                  isLoading={runDataQuery.isLoading && !compareMode}
                  hiddenColumns={hiddenColumns}
                  onToggleColumn={toggleColumn}
                  comparisonData={comparisonData}
                  targetColors={targetColors}
                />
              </Card.Body>
            </Card.Root>
          </Box>
        )}
      </VStack>
    </HStack>
  );
}
