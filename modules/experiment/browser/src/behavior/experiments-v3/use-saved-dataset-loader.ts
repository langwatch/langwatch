import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { api } from "@langwatch/browser-trpc/workflow-api";
import type { DatasetColumnType } from "@langwatch/dataset-contract";
import { useEffect, useRef, useState } from "react";

import type {
  DatasetColumn,
  DatasetReference,
  SavedRecord,
} from "../../model/experiments-v3/types.ts";
import { useEvaluationsV3Store } from "./use-evaluations-v3-store.ts";

/** A saved dataset's records as the workbench holds them: every value a string. */
const savedRecordsFrom = ({
  records,
  columnNames,
}: {
  records: { id: string; entry: unknown }[];
  columnNames: string[];
}): SavedRecord[] =>
  records.map((record) => ({
    id: record.id,
    ...Object.fromEntries(
      columnNames.map((name) => {
        const value = (record.entry as Record<string, unknown>)?.[name];
        if (value === null || value === undefined) return [name, ""];
        if (typeof value === "string") return [name, value];
        // Stringify objects/arrays instead of [object Object]
        return [name, JSON.stringify(value)];
      }),
    ),
  }));

/**
 * ADR-032 I-READY: a still-preparing or failed dataset read throws
 * PRECONDITION_FAILED; it has no rows yet, so it is not retried.
 */
const retryUnlessNotReady = (failureCount: number, error: unknown): boolean =>
  (error as { data?: { code?: string } })?.data?.code === "PRECONDITION_FAILED"
    ? false
    : failureCount < 3;

/**
 * Hook to load records for a single saved dataset.
 * Each saved dataset tab should use this hook to declaratively fetch its data.
 * tRPC handles batching multiple queries automatically.
 */
export const useSavedDatasetRecords = (dataset: DatasetReference | undefined) => {
  const { project } = useOrganizationTeamProject();
  const setSavedDatasetRecords = useEvaluationsV3Store((state) => state.setSavedDatasetRecords);
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
      retry: retryUnlessNotReady,
    },
  );

  // Sync to store when data arrives
  useEffect(() => {
    if (!dataset || !needsLoading || !query.data || hasLoadedRef.current) return;

    hasLoadedRef.current = true;

    const savedRecords = savedRecordsFrom({
      records: query.data.datasetRecords ?? [],
      columnNames: dataset.columns.map((col) => col.name),
    });

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

export type PendingDatasetLoad = {
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
  const [pendingDatasetLoad, setPendingDatasetLoad] = useState<PendingDatasetLoad | null>(null);

  // Query to load dataset records when adding a saved dataset
  const savedDatasetRecords = api.datasetRecord.getAll.useQuery(
    {
      projectId: projectId ?? "",
      datasetId: pendingDatasetLoad?.datasetId ?? "",
    },
    {
      enabled: !!projectId && !!pendingDatasetLoad,
      retry: retryUnlessNotReady,
    },
  );

  // Effect to handle when saved dataset records finish loading
  useEffect(() => {
    if (pendingDatasetLoad && savedDatasetRecords.data && !savedDatasetRecords.isLoading) {
      const { datasetId, name, columnTypes } = pendingDatasetLoad;

      // Build columns
      const columns: DatasetColumn[] = columnTypes.map((col, index) => ({
        id: `${col.name}_${index}`,
        name: col.name,
        type: col.type,
      }));

      // Transform records to SavedRecord format
      const savedRecords = savedRecordsFrom({
        records: savedDatasetRecords.data?.datasetRecords ?? [],
        columnNames: columnTypes.map((col) => col.name),
      });

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
