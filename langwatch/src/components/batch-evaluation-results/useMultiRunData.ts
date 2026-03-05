/**
 * useMultiRunData - Hook for fetching multiple run data in compare mode
 *
 * Uses separate queries for each run and combines the results.
 * Includes run color assignments for visual differentiation.
 */
import { useMemo } from "react";
import type { ExperimentRunWithItems } from "~/server/evaluations-v3/services/types";
import { api } from "~/utils/api";

// Run colors for comparison mode - distinct, accessible colors
export const RUN_COLORS = [
  "#3182ce", // blue
  "#dd6b20", // orange
  "#38a169", // green
  "#d53f8c", // pink
  "#805ad5", // purple
  "#e53e3e", // red
  "#319795", // teal
  "#718096", // gray
] as const;

export type RunWithColor = {
  runId: string;
  color: string;
  data: ExperimentRunWithItems | null;
  isLoading: boolean;
  error: unknown;
};

type UseMultiRunDataOptions = {
  projectId: string;
  experimentId: string;
  runIds: string[];
  enabled?: boolean;
  /** Refetch interval in ms (set to false for finished runs) */
  refetchInterval?: number | false;
  /** Stable color map for runs (key: runId, value: color) */
  runColorMap?: Record<string, string>;
};

type UseMultiRunDataReturn = {
  runs: RunWithColor[];
  isLoading: boolean;
  isAllLoaded: boolean;
  hasError: boolean;
};

/**
 * Fetches data for multiple runs in parallel
 *
 * Note: Due to hooks rules, we use a fixed number of queries (max 8)
 * and conditionally enable them based on the runIds array.
 */
export const useMultiRunData = ({
  projectId,
  experimentId,
  runIds,
  enabled = true,
  refetchInterval = false,
  runColorMap = {},
}: UseMultiRunDataOptions): UseMultiRunDataReturn => {
  // We need to call hooks unconditionally, so we set up the max number
  // and enable/disable based on whether we have that many runs
  const run0 = api.experiments.getExperimentBatchEvaluationRun.useQuery(
    { projectId, experimentId, runId: runIds[0] ?? "" },
    { enabled: enabled && !!runIds[0], refetchInterval },
  );
  const run1 = api.experiments.getExperimentBatchEvaluationRun.useQuery(
    { projectId, experimentId, runId: runIds[1] ?? "" },
    { enabled: enabled && !!runIds[1], refetchInterval },
  );
  const run2 = api.experiments.getExperimentBatchEvaluationRun.useQuery(
    { projectId, experimentId, runId: runIds[2] ?? "" },
    { enabled: enabled && !!runIds[2], refetchInterval },
  );
  const run3 = api.experiments.getExperimentBatchEvaluationRun.useQuery(
    { projectId, experimentId, runId: runIds[3] ?? "" },
    { enabled: enabled && !!runIds[3], refetchInterval },
  );
  const run4 = api.experiments.getExperimentBatchEvaluationRun.useQuery(
    { projectId, experimentId, runId: runIds[4] ?? "" },
    { enabled: enabled && !!runIds[4], refetchInterval },
  );
  const run5 = api.experiments.getExperimentBatchEvaluationRun.useQuery(
    { projectId, experimentId, runId: runIds[5] ?? "" },
    { enabled: enabled && !!runIds[5], refetchInterval },
  );
  const run6 = api.experiments.getExperimentBatchEvaluationRun.useQuery(
    { projectId, experimentId, runId: runIds[6] ?? "" },
    { enabled: enabled && !!runIds[6], refetchInterval },
  );
  const run7 = api.experiments.getExperimentBatchEvaluationRun.useQuery(
    { projectId, experimentId, runId: runIds[7] ?? "" },
    { enabled: enabled && !!runIds[7], refetchInterval },
  );

  const queries = [run0, run1, run2, run3, run4, run5, run6, run7];

  const runs: RunWithColor[] = useMemo(() => {
    return runIds.slice(0, 8).map((runId, idx) => ({
      runId,
      // Use stable color from map, or fallback to index-based color
      color: runColorMap[runId] ?? RUN_COLORS[idx % RUN_COLORS.length]!,
      data: queries[idx]?.data ?? null,
      isLoading: queries[idx]?.isLoading ?? false,
      error: queries[idx]?.error ?? null,
    }));
  }, [runIds, queries, runColorMap]);

  const isLoading = runs.some((r) => r.isLoading);
  const isAllLoaded = runs.every((r) => !r.isLoading && r.data !== null);
  const hasError = runs.some((r) => r.error !== null);

  return {
    runs,
    isLoading,
    isAllLoaded,
    hasError,
  };
};

/**
 * Get color for a run by index
 */
export const getRunColor = (index: number): string => {
  return RUN_COLORS[index % RUN_COLORS.length]!;
};
