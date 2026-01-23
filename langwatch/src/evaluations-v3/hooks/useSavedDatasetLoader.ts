import { useEffect, useRef, useState } from "react";
import type { DatasetColumnType } from "~/server/datasets/types";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import type { DatasetColumn, DatasetReference, SavedRecord } from "../types";
import { useEvaluationsV3Store } from "./useEvaluationsV3Store";

/**
 * Hook to load records for a single saved dataset.
 * Each saved dataset tab should use this hook to declaratively fetch its data.
 * tRPC handles batching multiple queries automatically.
 */
export const useSavedDatasetRecords = (
  dataset: DatasetReference | undefined,
) => {
  const { project } = useOrganizationTeamProject();
  const setSavedDatasetRecords = useEvaluationsV3Store(
    (state) => state.setSavedDatasetRecords,
  );
  const hasLoadedRef = useRef(false);

  const isSavedDataset =
    dataset?.type === "saved" && Boolean(dataset.datasetId);
  const needsLoading = isSavedDataset && !dataset.savedRecords;

  // Declarative query - tRPC batches these automatically
  const query = api.datasetRecord.getAll.useQuery(
    {
      projectId: project?.id ?? "",
      datasetId: dataset?.datasetId ?? "",
    },
    {
      enabled: Boolean(project?.id) && needsLoading,
    },
  );

  // Sync to store when data arrives
  useEffect(() => {
    if (!dataset || !needsLoading || !query.data || hasLoadedRef.current)
      return;

    hasLoadedRef.current = true;

    const savedRecords: SavedRecord[] = (query.data.datasetRecords ?? []).map(
      (record: { id: string; entry: unknown }) => ({
        id: record.id,
        ...Object.fromEntries(
          (dataset.columns as DatasetColumn[]).map((col) => {
            const value = (record.entry as Record<string, unknown>)?.[col.name];
            if (value === null || value === undefined) return [col.name, ""];
            if (typeof value === "string") return [col.name, value];
            // Properly stringify objects/arrays instead of [object Object]
            return [col.name, JSON.stringify(value)];
          }),
        ),
      }),
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
    (d) => d.type === "saved" && d.datasetId && !d.savedRecords,
  );

  return {
    isLoading: savedDatasetsNeedingRecords.length > 0,
    loadingCount: savedDatasetsNeedingRecords.length,
    datasetsToLoad: savedDatasetsNeedingRecords,
  };
};

// ============================================================================
// New Dataset Selection Hook
// ============================================================================

type PendingDatasetLoad = {
  datasetId: string;
  name: string;
  columnTypes: { name: string; type: DatasetColumnType }[];
};

type UseDatasetSelectionLoaderParams = {
  projectId: string | undefined;
  addDataset: (dataset: DatasetReference) => void;
  setActiveDataset: (datasetId: string) => void;
};

/**
 * Hook to handle loading a newly-selected saved dataset into the evaluations store.
 * Use this when the user selects a dataset from the drawer to add to the workbench.
 */
export const useDatasetSelectionLoader = ({
  projectId,
  addDataset,
  setActiveDataset,
}: UseDatasetSelectionLoaderParams) => {
  // State to track pending dataset loads
  const [pendingDatasetLoad, setPendingDatasetLoad] =
    useState<PendingDatasetLoad | null>(null);

  // Query to load dataset records when adding a saved dataset
  const savedDatasetRecords = api.datasetRecord.getAll.useQuery(
    {
      projectId: projectId ?? "",
      datasetId: pendingDatasetLoad?.datasetId ?? "",
    },
    {
      enabled: !!projectId && !!pendingDatasetLoad,
    },
  );

  // Effect to handle when saved dataset records finish loading
  useEffect(() => {
    if (
      pendingDatasetLoad &&
      savedDatasetRecords.data &&
      !savedDatasetRecords.isLoading
    ) {
      const { datasetId, name, columnTypes } = pendingDatasetLoad;

      // Build columns
      const columns: DatasetColumn[] = columnTypes.map((col, index) => ({
        id: `${col.name}_${index}`,
        name: col.name,
        type: col.type,
      }));

      // Transform records to SavedRecord format
      const savedRecords: SavedRecord[] = (
        savedDatasetRecords.data?.datasetRecords ?? []
      ).map((record: { id: string; entry: unknown }) => ({
        id: record.id,
        ...Object.fromEntries(
          columnTypes.map((col) => {
            const value = (record.entry as Record<string, unknown>)?.[col.name];
            if (value === null || value === undefined) return [col.name, ""];
            if (typeof value === "string") return [col.name, value];
            // Properly stringify objects/arrays instead of [object Object]
            return [col.name, JSON.stringify(value)];
          }),
        ),
      }));

      const newDataset: DatasetReference = {
        id: `saved_${datasetId}`,
        name,
        type: "saved",
        datasetId,
        columns,
        savedRecords,
      };

      addDataset(newDataset);
      setActiveDataset(newDataset.id);
      setPendingDatasetLoad(null);
    }
  }, [
    pendingDatasetLoad,
    savedDatasetRecords.data,
    savedDatasetRecords.isLoading,
    addDataset,
    setActiveDataset,
  ]);

  return {
    loadSavedDataset: setPendingDatasetLoad,
    isLoading: savedDatasetRecords.isLoading && !!pendingDatasetLoad,
  };
};
