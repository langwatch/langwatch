import { datasetClient } from "@langwatch/dataset-client";
import { useMemo } from "react";

/** One version a saved dataset can be pinned to, as the pin select lists it. */
export type DatasetVersionOption = { version: number; name: string | null };

/**
 * The versions a saved dataset has, newest first, for the experiment's pin select.
 * Spec: specs/experiments-v3/dataset-version-pin.feature.
 */
export function useDatasetVersionOptions({
  projectId,
  datasetId,
}: {
  projectId: string | undefined;
  datasetId: string | undefined;
}): { versions: DatasetVersionOption[] } {
  const query = datasetClient.dataset.versions.useQuery(
    { projectId: projectId ?? "", datasetId: datasetId ?? "" },
    { enabled: Boolean(projectId) && Boolean(datasetId) },
  );

  const versions = useMemo(
    () =>
      (query.data?.versions ?? [])
        .map(({ version, name }) => ({ version, name }))
        .toSorted((a, b) => b.version - a.version),
    [query.data],
  );

  return { versions };
}
