/**
 * Hook for cancelling scenario runs via event-sourcing.
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */

import { useCallback } from "react";
import { isCancellableStatus } from "@langwatch/scenario-contract";
import { api } from "../scenario-api";

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
  const cancelJobMutation = api.scenarios.cancelJob.useMutation({
    onSuccess: (result) => {
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

  const cancelBatchRunMutation = api.scenarios.cancelBatchRun.useMutation({
    onSuccess: () => {
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
