import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { datasetClient } from "@langwatch/dataset-client";
import type { DatasetColumnType } from "@langwatch/dataset-contract";
import isDeepEqual from "fast-deep-equal";
import { useEffect, useRef, useState } from "react";

import {
  refreshedSavedRecords,
  sameColumnNames,
} from "../../model/experiments-v3/saved-records-refresh.ts";
import type {
  DatasetColumn,
  DatasetReference,
  SavedRecord,
  SavedRecordsCut,
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

/** What a read that left rows out says it loaded, and nothing for a whole read. */
const savedRecordsCutOf = (read: {
  truncated: boolean;
  loadedRows: number;
  totalRows: number;
}): SavedRecordsCut | undefined =>
  read.truncated ? { loadedRows: read.loadedRows, totalRows: read.totalRows } : undefined;

/**
 * ADR-032 I-READY: a still-preparing or failed dataset read throws
 * PRECONDITION_FAILED; it has no rows yet, so it is not retried.
 */
const retryUnlessNotReady = (failureCount: number, error: unknown): boolean =>
  (error as { data?: { code?: string } })?.data?.code === "PRECONDITION_FAILED"
    ? false
    : failureCount < 3;

/**
 * Loads one saved dataset tab's records, then follows the read: when the dataset changes
 * elsewhere and its read refetches, the rows refresh under this tab's unsynced edits.
 * Spec: specs/experiments-v3/dataset-version-pin.feature
 */
export const useSavedDatasetRecords = (dataset: DatasetReference | undefined) => {
  const { project } = useOrganizationTeamProject();
  const setSavedDatasetRecords = useEvaluationsV3Store((state) => state.setSavedDatasetRecords);
  const appliedAtRef = useRef<number | undefined>(undefined);

  const isSavedDataset = dataset?.type === "saved" && Boolean(dataset.datasetId);
  const needsLoading = isSavedDataset && !dataset.savedRecords;

  const query = datasetClient.datasetRecord.getAll.useQuery(
    {
      projectId: project?.id ?? "",
      datasetId: dataset?.datasetId ?? "",
    },
    {
      enabled: Boolean(project?.id) && isSavedDataset,
      retry: retryUnlessNotReady,
    },
  );

  useEffect(() => {
    if (!dataset || !isSavedDataset || !query.data) return;
    if (appliedAtRef.current === query.dataUpdatedAt && !needsLoading) return;
    // A read held for other columns stays unrecorded, so it applies once the tab's columns match.
    if (applySavedRead({ dataset, read: query.data, setSavedDatasetRecords })) {
      appliedAtRef.current = query.dataUpdatedAt;
    }
  }, [
    dataset,
    isSavedDataset,
    needsLoading,
    query.data,
    query.dataUpdatedAt,
    setSavedDatasetRecords,
  ]);

  useEffect(() => {
    appliedAtRef.current = undefined;
  }, [dataset?.id]);

  return {
    isLoading: query.isLoading && needsLoading,
  };
};

type SavedRead = {
  columnTypes: { name: string }[];
  datasetRecords?: { id: string; entry: unknown }[];
  truncated: boolean;
  loadedRows: number;
  totalRows: number;
};

/**
 * Puts a read into the tab: whole on the first load, under the unsynced edits after that.
 * False when the read is held because its columns differ from the tab's.
 */
function applySavedRead({
  dataset,
  read,
  setSavedDatasetRecords,
}: {
  dataset: DatasetReference;
  read: SavedRead;
  setSavedDatasetRecords: (id: string, records: SavedRecord[], cut?: SavedRecordsCut) => void;
}): boolean {
  const columnNames = dataset.columns.map((col) => col.name);
  const fresh = savedRecordsFrom({ records: read.datasetRecords ?? [], columnNames });
  const cut = savedRecordsCutOf(read);
  if (!dataset.savedRecords) {
    setSavedDatasetRecords(dataset.id, fresh, cut);
    return true;
  }
  // Columns that differ mean a column edit is in flight or landed elsewhere: keying the read by
  // this tab's names would blank cells, so the read is held until the tab's columns match.
  const serverColumns = read.columnTypes.map((column) => column.name);
  if (!sameColumnNames({ serverColumns, workbenchColumns: columnNames })) return false;
  const store = useEvaluationsV3Store.getState();
  const refreshed = refreshedSavedRecords({
    fresh,
    current: dataset.savedRecords,
    pending: dataset.datasetId ? store.pendingSavedChanges[dataset.datasetId] : undefined,
  });
  const sameRows = isDeepEqual(refreshed, dataset.savedRecords);
  if (sameRows && isDeepEqual(cut, dataset.savedRecordsCut)) return true;
  // A refresh is no edit, so it takes no undo step, nor opens the window that folds the next edit.
  untracked(() => setSavedDatasetRecords(dataset.id, refreshed, cut));
  if (sameRows) carryCutThroughHistory({ tabId: dataset.id, cut });
  // Undo must not step back onto rows the dataset no longer holds.
  else useEvaluationsV3Store.temporal.getState().clear();
  return true;
}

function untracked(write: () => void) {
  const temporal = useEvaluationsV3Store.temporal.getState();
  const wasTracking = temporal.isTracking;
  if (wasTracking) temporal.pause();
  try {
    write();
  } finally {
    if (wasTracking) temporal.resume();
  }
}

/** Undo and Redo restore edits, never a row count the dataset has since moved past. */
function carryCutThroughHistory({ tabId, cut }: { tabId: string; cut?: SavedRecordsCut }) {
  const withCut = <T extends { datasets?: DatasetReference[] }>(snapshot: T): T =>
    snapshot.datasets
      ? {
          ...snapshot,
          datasets: snapshot.datasets.map((d) =>
            d.id === tabId && d.savedRecords ? { ...d, savedRecordsCut: cut } : d,
          ),
        }
      : snapshot;
  const { pastStates, futureStates } = useEvaluationsV3Store.temporal.getState();
  useEvaluationsV3Store.temporal.setState({
    pastStates: pastStates.map(withCut),
    futureStates: futureStates.map(withCut),
  });
}

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
  const savedDatasetRecords = datasetClient.datasetRecord.getAll.useQuery(
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
        savedRecordsCut: savedRecordsCutOf(savedDatasetRecords.data),
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
