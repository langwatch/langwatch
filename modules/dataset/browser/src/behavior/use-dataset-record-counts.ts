import { datasetClient } from "@langwatch/dataset-client";

/**
 * The entry count of each listed dataset, asked once the list has arrived so
 * the list never waits on it. Empty until the counts land; a missing id means
 * its count is still on its way. @see specs/datasets/datasets-list-page.feature
 */
export function useDatasetRecordCounts({
  projectId,
  datasets,
}: {
  projectId: string | undefined;
  datasets: readonly { id: string }[] | undefined;
}): ReadonlyMap<string, number> {
  const datasetIds = (datasets ?? []).map((dataset) => dataset.id);
  const counts = datasetClient.dataset.recordCounts.useQuery(
    { projectId: projectId ?? "", datasetIds },
    { enabled: !!projectId && datasetIds.length > 0 },
  );

  return new Map((counts.data ?? []).map((count) => [count.datasetId, count.recordCount]));
}
