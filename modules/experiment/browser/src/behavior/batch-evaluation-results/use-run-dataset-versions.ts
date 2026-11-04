import { datasetClient } from "@langwatch/dataset-client";
import { useMemo } from "react";

/** The most runs one lookup names, as the dataset's `runVersions` read accepts. */
const RUN_IDS_PER_LOOKUP = 200;

/**
 * The dataset version each run read, keyed by run id; a run that read none
 * (inline rows, or a run from before versioning) is absent.
 * Spec: modules/dataset/specs/dataset-versioning.feature, "Experiments".
 */
export function useRunDatasetVersions({
  projectId,
  runIds,
}: {
  projectId: string | undefined;
  runIds: string[];
}): Record<string, number> {
  const lookedUp = useMemo(() => runIds.slice(0, RUN_IDS_PER_LOOKUP), [runIds]);
  const query = datasetClient.dataset.runVersions.useQuery(
    { projectId: projectId ?? "", runIds: lookedUp },
    { enabled: Boolean(projectId) && lookedUp.length > 0 },
  );

  return useMemo(
    () => Object.fromEntries((query.data ?? []).map((link) => [link.runId, link.version])),
    [query.data],
  );
}
