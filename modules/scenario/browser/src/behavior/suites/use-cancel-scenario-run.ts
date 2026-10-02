/**
 * Hook for cancelling scenario runs via event-sourcing.
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */

import { scenarioClient } from "@langwatch/scenario-client";
import { isCancellableStatus } from "@langwatch/scenario-contract";
import { useCallback } from "react";

export { isCancellableStatus };

/** Parameters for cancelling a single scenario run. */
export interface CancelRunParams {
  projectId: string;
  scenarioSetId: string;
  batchRunId: string;
  scenarioRunId: string;
  scenarioId: string;
}

/** Parameters for cancelling all remaining runs in a batch. */
export interface CancelBatchParams {
  projectId: string;
  scenarioSetId: string;
  batchRunId: string;
}

/**
 * Hook providing cancel mutations for scenario runs.
 */
export function useCancelScenarioRun({
  onCancelJobSuccess,
  onCancelJobError,
  onCancelBatchSuccess,
  onCancelBatchError,
}: {
  onCancelJobSuccess?: () => void;
  onCancelJobError?: (error: { message: string }) => void;
  onCancelBatchSuccess?: () => void;
  onCancelBatchError?: (error: { message: string }) => void;
} = {}) {
  const utils = scenarioClient.useUtils();
  const invalidateRuns = () => {
    void utils.scenarios.getRunState.invalidate();
    void utils.scenarios.getBatchRunData.invalidate();
    void utils.scenarios.getSuiteRunData.invalidate();
  };

  const cancelJobMutation = scenarioClient.scenarios.cancelJob.useMutation({
    onSuccess: (result) => {
      invalidateRuns();
      if (result.cancelled) {
        onCancelJobSuccess?.();
      } else {
        onCancelJobError?.({
          message: "Job could not be cancelled — it may have already completed",
        });
      }
    },
    onError: (error) => {
      onCancelJobError?.(error);
    },
  });

  const cancelBatchRunMutation = scenarioClient.scenarios.cancelBatchRun.useMutation({
    onSuccess: () => {
      invalidateRuns();
      onCancelBatchSuccess?.();
    },
    onError: (error) => {
      onCancelBatchError?.(error);
    },
  });

  const cancelJob = useCallback(
    (params: CancelRunParams) => {
      cancelJobMutation.mutate(params);
    },
    [cancelJobMutation],
  );

  const cancelBatchRun = useCallback(
    (params: CancelBatchParams) => {
      cancelBatchRunMutation.mutate(params);
    },
    [cancelBatchRunMutation],
  );

  return {
    cancelJob,
    cancelBatchRun,
    isCancellingJob: cancelJobMutation.isPending,
    isCancellingBatch: cancelBatchRunMutation.isPending,
  };
}
