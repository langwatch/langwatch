import type { DatasetColumn, DatasetReference } from "@langwatch/experiment-contract";

import type { ExperimentRunProgressState } from "../repositories/experiment-run-fold.repository.ts";

/**
 * A run awaits its start until `started` numbers its first frame: a requested evaluation is
 * stored running before that, as main registered it, and a refusal before it is stored failed.
 */
export function runAwaitsStart(state: ExperimentRunProgressState): boolean {
  return state.status === "pending" || (state.status === "running" && state.seq === 0);
}

/**
 * A requested evaluation runs unless its start is already folded. A fold that has not caught up
 * reads as untouched: a second StartExperimentRun is dropped by its idempotency key.
 */
export function requestedRunIsUntouched({
  state,
  experimentId,
}: {
  state: ExperimentRunProgressState | undefined;
  experimentId: string;
}): boolean {
  if (!state || state.experimentId !== experimentId) return true;

  return runAwaitsStart(state);
}

/** Stable id for the single dataset of a workflow experiment. */
export const WORKFLOW_DATASET_ID = "workflow-dataset";

/** The dataset reference stored on the run, saved when an id resolved and inline otherwise. */
export function persistedDatasetRef({
  workflowName,
  columns,
  resolvedDatasetId,
}: {
  workflowName: string;
  columns: DatasetColumn[];
  resolvedDatasetId: string | undefined;
}): DatasetReference {
  return resolvedDatasetId
    ? {
        id: WORKFLOW_DATASET_ID,
        name: workflowName,
        type: "saved",
        datasetId: resolvedDatasetId,
        columns,
      }
    : {
        id: WORKFLOW_DATASET_ID,
        name: workflowName,
        type: "inline",
        inline: { columns, records: {} },
        columns,
      };
}
