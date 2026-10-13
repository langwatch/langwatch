import { datasetClient } from "@langwatch/dataset-client";
import { DATASET_DEFAULT_LIMITS, type DatasetLimits } from "@langwatch/dataset-contract";

/** How long an answer is reused: a limit changes only when an operator raises it. */
const LIMITS_STALE_MS = 5 * 60 * 1000;

/**
 * The dataset size limits the project's organization answers, for the
 * checks the browser makes before sending a file. The defaults stand in while
 * the answer loads; the server holds every write to the real limit either way.
 */
export function useDatasetLimits(projectId: string | undefined): DatasetLimits {
  const limits = datasetClient.dataset.getLimits.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId, staleTime: LIMITS_STALE_MS, refetchOnWindowFocus: false },
  );

  return limits.data ?? DATASET_DEFAULT_LIMITS;
}
