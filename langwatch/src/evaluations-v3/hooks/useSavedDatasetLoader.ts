import { useEffect, useRef } from "react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import type { DatasetColumn, DatasetReference, SavedRecord } from "../types";
import { useEvaluationsV3Store } from "./useEvaluationsV3Store";

/**
 * Hook to load records for a single saved dataset.
 * Each saved dataset tab should use this hook to declaratively fetch its data.
 * tRPC handles batching multiple queries automatically.
 */
export const useSavedDatasetRecords = (dataset: DatasetReference | undefined) => {
  const { project } = useOrganizationTeamProject();
  const setSavedDatasetRecords = useEvaluationsV3Store(
    (state) => state.setSavedDatasetRecords
  );
  const hasLoadedRef = useRef(false);

  const isSavedDataset = dataset?.type === "saved" && Boolean(dataset.datasetId);
  const needsLoading = isSavedDataset && !dataset.savedRecords;

  // Declarative query - tRPC batches these automatically
  const query = api.datasetRecord.getAll.useQuery(
    {
      projectId: project?.id ?? "",
      datasetId: dataset?.datasetId ?? "",
    },
    {
      enabled: Boolean(project?.id) && needsLoading,
    }
  );

  // Sync to store when data arrives
  useEffect(() => {
    if (!dataset || !needsLoading || !query.data || hasLoadedRef.current) return;

    hasLoadedRef.current = true;

    const savedRecords: SavedRecord[] = (query.data.datasetRecords ?? []).map(
      (record: { id: string; entry: unknown }) => ({
        id: record.id,
        ...Object.fromEntries(
          (dataset.columns as DatasetColumn[]).map((col) => [
            col.name,
            String((record.entry as Record<string, unknown>)?.[col.name] ?? ""),
          ])
        ),
      })
    );

    setSavedDatasetRecords(dataset.id, savedRecords);
  }, [dataset, needsLoading, query.data, setSavedDatasetRecords]);

  // Reset ref when dataset changes
  useEffect(() => {
    hasLoadedRef.current = false;
  }, [dataset?.id]);

  return {
    isLoading: query.isLoading && needsLoading,
  };
};

/**
 * Hook to track loading state for all saved datasets.
 * Uses individual queries per dataset - tRPC handles batching.
 */
export const useSavedDatasetLoader = () => {
  const datasets = useEvaluationsV3Store((state) => state.datasets);

  // Find saved datasets that need records loaded
  const savedDatasetsNeedingRecords = datasets.filter(
    (d) => d.type === "saved" && d.datasetId && !d.savedRecords
  );

  return {
    isLoading: savedDatasetsNeedingRecords.length > 0,
    loadingCount: savedDatasetsNeedingRecords.length,
    datasetsToLoad: savedDatasetsNeedingRecords,
  };
};
