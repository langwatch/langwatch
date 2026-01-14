/**
 * BatchEvaluationResults - Main wrapper component for batch evaluation results
 *
 * This is the main entry point that combines the sidebar and table.
 * It replaces BatchEvaluationV2 with a cleaner, V3-style visualization.
 */
import { useMemo, useCallback, useState, useEffect } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Skeleton,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { Experiment, Project } from "@prisma/client";
import { Download, ExternalLink, BarChart2 } from "react-feather";

import { Link } from "~/components/ui/link";
import { api } from "~/utils/api";

import {
  BatchEvaluationResultsTable,
  ColumnVisibilityButton,
  DEFAULT_HIDDEN_COLUMNS,
} from "./BatchEvaluationResultsTable";
import { BatchRunsSidebar, type BatchRunSummary } from "./BatchRunsSidebar";
import {
  transformBatchEvaluationData,
  type BatchEvaluationData,
} from "./types";
import { useBatchEvaluationDownloadCSV } from "../experiments/BatchEvaluationV2/BatchEvaluationV2EvaluationResults";
import { useComparisonMode } from "./useComparisonMode";
import {
  useMultiRunData,
  type RunWithColor,
  RUN_COLORS,
} from "./useMultiRunData";
import { ComparisonCharts, type XAxisOption } from "./ComparisonCharts";
import { PageLayout } from "../ui/layouts/PageLayout";

/**
 * Skeleton loading state that looks like a table
 */
const TableSkeleton = () => (
  <Card.Root width="100%" overflow="hidden">
    <Card.Body padding={0}>
      <Box
        css={{
          "& table": { width: "100%", borderCollapse: "collapse" },
          "& th": {
            borderBottom: "1px solid var(--chakra-colors-gray-200)",
            padding: "8px 12px",
            textAlign: "left",
          },
          "& td": {
            borderBottom: "1px solid var(--chakra-colors-gray-100)",
            padding: "12px",
          },
        }}
      >
        <table>
          <thead>
            <tr>
              <th style={{ width: 32 }} />
              <th style={{ width: 150 }}>
                <Skeleton height="16px" width="80px" />
              </th>
              <th style={{ width: 150 }}>
                <Skeleton height="16px" width="100px" />
              </th>
              <th style={{ width: 280 }}>
                <Skeleton height="16px" width="120px" />
              </th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, rowIdx) => (
              <tr key={rowIdx}>
                <td style={{ width: 32 }}>
                  <Skeleton height="14px" width="16px" />
                </td>
                <td style={{ width: 150 }}>
                  <Skeleton height="40px" />
                </td>
                <td style={{ width: 150 }}>
                  <Skeleton height="40px" />
                </td>
                <td style={{ width: 280 }}>
                  <Skeleton height="60px" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    </Card.Body>
  </Card.Root>
);

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

/**
 * Check if a run is finished based on timestamps
 */
const isRunFinished = (timestamps: {
  finished_at?: number | null;
  stopped_at?: number | null;
  updated_at?: number;
}): boolean => {
  return !!(timestamps.finished_at ?? timestamps.stopped_at);
};

export function BatchEvaluationResults({
  project,
  experiment,
  size = "md",
  selectedRunId: externalSelectedRunId,
  onSelectRunId,
}: BatchEvaluationResultsProps) {
  // Track if any run is still in progress
  const [isSomeRunning, setIsSomeRunning] = useState(false);

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

  // Internal state for run selection (used when not controlled)
  const [internalSelectedRunId, setInternalSelectedRunId] = useState<
    string | undefined
  >();

  // Determine which run ID to use
  const selectedRunId =
    externalSelectedRunId ??
    internalSelectedRunId ??
    runsQuery.data?.runs[0]?.run_id;

  // Handle run selection
  const handleSelectRun = useCallback(
    (runId: string) => {
      if (onSelectRunId) {
        onSelectRunId(runId);
      } else {
        setInternalSelectedRunId(runId);
      }
    },
    [onSelectRunId],
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

  // Update isSomeRunning state
  useEffect(() => {
    const hasRunning = runsQuery.data?.runs.some(
      (r) => !isRunFinished(r.timestamps),
    );
    setIsSomeRunning(!!hasRunning);
  }, [runsQuery.data?.runs]);

  // Fetch selected run data
  const runDataQuery = api.experiments.getExperimentBatchEvaluationRun.useQuery(
    {
      projectId: project.id,
      experimentId: experiment.id,
      runId: selectedRunId ?? "",
    },
    {
      enabled: !!selectedRunId,
      refetchInterval: !isFinished ? 1000 : false,
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
      color: run.color,
      data: run.data ? transformBatchEvaluationData(run.data) : null,
      isLoading: run.isLoading,
    }));
  }, [compareMode, multiRunData.runs]);

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
        color: stableRunColorMap[transformedData.runId] ?? RUN_COLORS[0],
        data: transformedData,
        isLoading: false,
      },
    ];
  }, [compareMode, transformedData, targetCount, stableRunColorMap]);

  // Chart data to display - either comparison data or single run data
  const chartDisplayData = compareMode ? comparisonData : singleRunChartData;

  // Target colors from charts (when X-axis is "target")
  const [targetColors, setTargetColors] = useState<Record<string, string>>({});

  // Run colors are now stable - use the stable map created above
  const runColors = stableRunColorMap;

  // Find sidebar run for selected
  const sidebarSelectedRun = sidebarRuns.find((r) => r.runId === selectedRunId);

  // CSV download
  const { downloadCSV, isDownloadCSVEnabled } = useBatchEvaluationDownloadCSV({
    project,
    experiment,
    runId: selectedRunId,
    isFinished,
  });

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
    <HStack align="start" width="full" height="full" gap={0}>
      {/* Sidebar */}
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

      {/* Main content */}
      <VStack
        width="full"
        height="fit-content"
        minHeight="100%"
        position="relative"
        gap={0}
        justify="space-between"
        minWidth="0"
      >
        <VStack align="start" width="full" height="full" gap={0} padding={0}>
          {/* Header */}
          <PageLayout.Header paddingX={2} withBorder={false}>
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
              onClick={() => void downloadCSV()}
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
          </PageLayout.Header>

          {/* Charts (comparison or single-run with multiple targets) */}
          {canShowCharts && chartDisplayData && chartDisplayData.length > 0 && (
            <ComparisonCharts
              comparisonData={chartDisplayData}
              isVisible={chartsVisible}
              onVisibilityChange={setChartsVisible}
              onTargetColorsChange={setTargetColors}
            />
          )}

          {/* Loading state */}
          {runsQuery.isLoading ? (
            <TableSkeleton />
          ) : sidebarRuns.length === 0 ? (
            <Text>Waiting for results...</Text>
          ) : (
            <Box width="full" paddingRight={2}>
              <Card.Root width="100%" overflow="hidden">
                <Card.Body padding={0}>
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
      </VStack>
    </HStack>
  );
}
