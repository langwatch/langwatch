/**
 * Hook for cancelling scenario runs with optimistic UI updates.
 *
 * Provides `cancelJob` (single run) and `cancelBatchRun` (all remaining)
 * mutations that immediately update the local status to CANCELLED before
 * the server confirms.
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */

import { useCallback } from "react";
import { api } from "~/utils/api";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";

/** Statuses eligible for cancellation (mirrors server-side CANCELLABLE_STATUSES). */
const CANCELLABLE_STATUSES = new Set<ScenarioRunStatus>([
  ScenarioRunStatus.PENDING,
  ScenarioRunStatus.IN_PROGRESS,
  ScenarioRunStatus.STALLED,
]);

/** Checks whether a run status can be cancelled. */
export function isCancellableStatus(status: ScenarioRunStatus): boolean {
  return CANCELLABLE_STATUSES.has(status);
}

/** Parameters for cancelling a single scenario run. */
export interface CancelRunParams {
  projectId: string;
  jobId: string;
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
 *
 * Both mutations trigger an `onOptimisticUpdate` callback immediately
 * so the parent component can update local state before the server responds.
 *
 * @param onOptimisticUpdate - Called with scenarioRunIds that should be
 *   optimistically marked as cancelled.
 */
export function useCancelScenarioRun({
  onOptimisticUpdate,
}: {
  onOptimisticUpdate?: (scenarioRunIds: string[]) => void;
} = {}) {
  const cancelJobMutation = api.scenarios.cancelJob.useMutation();
  const cancelBatchRunMutation = api.scenarios.cancelBatchRun.useMutation();

  const cancelJob = useCallback(
    (params: CancelRunParams) => {
      if (onOptimisticUpdate) {
        onOptimisticUpdate([params.scenarioRunId]);
      }
      cancelJobMutation.mutate(params);
    },
    [cancelJobMutation, onOptimisticUpdate],
  );

  const cancelBatchRun = useCallback(
    (params: CancelBatchParams, cancellableRunIds: string[]) => {
      if (onOptimisticUpdate) {
        onOptimisticUpdate(cancellableRunIds);
      }
      cancelBatchRunMutation.mutate(params);
    },
    [cancelBatchRunMutation, onOptimisticUpdate],
  );

  return {
    cancelJob,
    cancelBatchRun,
    isCancellingJob: cancelJobMutation.isPending,
    isCancellingBatch: cancelBatchRunMutation.isPending,
  };
}
