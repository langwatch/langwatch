import { datasetClient } from "@langwatch/dataset-client";

/**
 * The entry count of each listed dataset, asked once the list has arrived so
 * the list never waits on it. A missing id is still on its way, unless
 * `countsFailed` says the read gave up. @see specs/datasets/datasets-list-page.feature
 */
export function useDatasetRecordCounts({
  projectId,
  datasets,
}: {
  projectId: string | undefined;
  datasets: readonly { id: string }[] | undefined;
}): { recordCounts: ReadonlyMap<string, number>; countsFailed: boolean } {
  const datasetIds = (datasets ?? []).map((dataset) => dataset.id);
  const counts = datasetClient.dataset.recordCounts.useQuery(
    { projectId: projectId ?? "", datasetIds },
    { enabled: !!projectId && datasetIds.length > 0 },
  );

  return {
    recordCounts: new Map((counts.data ?? []).map((count) => [count.datasetId, count.recordCount])),
    countsFailed: counts.isError,
  };
}
