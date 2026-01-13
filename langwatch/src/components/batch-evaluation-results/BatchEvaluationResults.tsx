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
import { Download, ExternalLink } from "react-feather";

import { Link } from "~/components/ui/link";
import { api } from "~/utils/api";

import { BatchEvaluationResultsTable } from "./BatchEvaluationResultsTable";
import { BatchRunsSidebar, type BatchRunSummary } from "./BatchRunsSidebar";
import { transformBatchEvaluationData, type BatchEvaluationData } from "./types";
import { useBatchEvaluationDownloadCSV } from "../experiments/BatchEvaluationV2/BatchEvaluationV2EvaluationResults";

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
              <th style={{ width: 36 }} />
              <th style={{ width: 150 }}><Skeleton height="16px" width="80px" /></th>
              <th style={{ width: 150 }}><Skeleton height="16px" width="100px" /></th>
              <th style={{ width: 280 }}><Skeleton height="16px" width="120px" /></th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, rowIdx) => (
              <tr key={rowIdx}>
                <td style={{ width: 36 }}><Skeleton height="14px" width="20px" /></td>
                <td style={{ width: 150 }}><Skeleton height="40px" /></td>
                <td style={{ width: 150 }}><Skeleton height="40px" /></td>
                <td style={{ width: 280 }}><Skeleton height="60px" /></td>
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

  // Fetch runs list
  const runsQuery = api.experiments.getExperimentBatchEvaluationRuns.useQuery(
    {
      projectId: project.id,
      experimentId: experiment.id,
    },
    {
      refetchInterval: isSomeRunning ? 3000 : 10000,
    }
  );

  // Internal state for run selection (used when not controlled)
  const [internalSelectedRunId, setInternalSelectedRunId] = useState<string | undefined>();

  // Determine which run ID to use
  const selectedRunId = externalSelectedRunId ?? internalSelectedRunId ?? runsQuery.data?.runs[0]?.run_id;

  // Handle run selection
  const handleSelectRun = useCallback(
    (runId: string) => {
      if (onSelectRunId) {
        onSelectRunId(runId);
      } else {
        setInternalSelectedRunId(runId);
      }
    },
    [onSelectRunId]
  );

  // Find selected run
  const selectedRun = useMemo(
    () => runsQuery.data?.runs.find((r) => r.run_id === selectedRunId),
    [runsQuery.data?.runs, selectedRunId]
  );

  // Determine if selected run is finished
  const isFinished = useMemo(() => {
    if (!selectedRun) return false;
    return isRunFinished(selectedRun.timestamps);
  }, [selectedRun]);

  // Update isSomeRunning state
  useEffect(() => {
    const hasRunning = runsQuery.data?.runs.some(
      (r) => !isRunFinished(r.timestamps)
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
    }
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
          ])
        ),
      },
    }));
  }, [runsQuery.data?.runs]);

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
        <VStack align="start" width="full" height="full" gap={6} padding={6}>
          {/* Header */}
          <HStack width="full" align="center" gap={4}>
            <Heading>
              {experiment.name ?? experiment.slug}
            </Heading>
            <Spacer />
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
                <Button
                  size="sm"
                  variant="outline"
                  textDecoration="none"
                >
                  <ExternalLink size={16} /> Open Workflow
                </Button>
              </Link>
            )}
          </HStack>

          {/* Loading state */}
          {runsQuery.isLoading ? (
            <TableSkeleton />
          ) : sidebarRuns.length === 0 ? (
            <Text>Waiting for results...</Text>
          ) : (
            <Card.Root width="100%" overflow="hidden">
              <Card.Body padding={0}>
                <BatchEvaluationResultsTable
                  data={transformedData}
                  isLoading={runDataQuery.isLoading}
                />
              </Card.Body>
            </Card.Root>
          )}
        </VStack>
      </VStack>
    </HStack>
  );
}
