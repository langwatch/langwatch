/** Debounced sync of edited records: full replace + delete-marked deletions.
 * Save status via onStatus callback for autosave indicator.
 */
import type { AutosaveState } from "@langwatch/dataset-browser-kit";
import { useCallback, useEffect, useRef } from "react";

import type { PendingSavedChanges } from "../model/pending-saved-changes.ts";
import { datasetApi } from "./dataset-api.ts";

export const DATASET_SYNC_DEBOUNCE_MS = 500;

/** pendingChanges shape: dbDatasetId -> recordId -> column changes.
 *  A record with `_delete: true` is a pending deletion. */
export type DatasetRecordSyncParams = {
  projectId: string | undefined;
  pendingSavedChanges: PendingSavedChanges;
  /** Resolve the full current record (all columns + id) for an update.
   *  Return undefined to skip syncing that record this round. */
  resolveFullRecord: (
    dbDatasetId: string,
    recordId: string,
  ) => ({ id: string } & Record<string, unknown>) | undefined;
  clearPendingChange: (dbDatasetId: string, recordId: string) => void;
  onStatus: (state: AutosaveState, error?: string) => void;
  /** Called once after a sync batch that deleted records fully settles. The
   *  paginated editor uses it to refresh the server total, so the pager can't
   *  strand the user on a now-empty last page (the local store only holds the
   *  current page, so it can't know the new whole-dataset count on its own). */
  onRecordsDeleted?: () => void;
};

export const useDatasetRecordSync = ({
  projectId,
  pendingSavedChanges,
  resolveFullRecord,
  clearPendingChange,
  onStatus,
  onRecordsDeleted,
}: DatasetRecordSyncParams) => {
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingOpsRef = useRef(0);

  // Mutations stored in refs so mutation state changes (isLoading, etc.)
  // don't re-trigger the sync effect.
  const updateSavedRecord = datasetApi.datasetRecord.update.useMutation();
  const deleteSavedRecords = datasetApi.datasetRecord.deleteMany.useMutation();
  const updateRef = useRef(updateSavedRecord);
  updateRef.current = updateSavedRecord;
  const deleteRef = useRef(deleteSavedRecords);
  deleteRef.current = deleteSavedRecords;

  // Refs to avoid stale closures in the debounced effect
  const pendingChangesRef = useRef(pendingSavedChanges);
  pendingChangesRef.current = pendingSavedChanges;
  const resolveFullRecordRef = useRef(resolveFullRecord);
  resolveFullRecordRef.current = resolveFullRecord;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const onRecordsDeletedRef = useRef(onRecordsDeleted);
  onRecordsDeletedRef.current = onRecordsDeleted;
  // Set when the current batch successfully deletes records; consumed when the
  // batch fully drains so the count refresh runs exactly once, after all writes
  // (never mid-batch, which would reload the store and strand a pending update).
  const batchHadDeleteRef = useRef(false);

  useEffect(() => {
    return () => {
      if (savedTimeoutRef.current) {
        clearTimeout(savedTimeoutRef.current);
      }
    };
  }, []);

  // Transition to "saved" then back to "idle" after a short delay
  const markSaved = useCallback(() => {
    onStatusRef.current("saved");
    if (savedTimeoutRef.current) {
      clearTimeout(savedTimeoutRef.current);
    }
    savedTimeoutRef.current = setTimeout(() => {
      onStatusRef.current("idle");
    }, 2000);
  }, []);

  const handleSyncStart = useCallback(() => {
    pendingOpsRef.current += 1;
    onStatusRef.current("saving");
  }, []);

  // Once the batch fully drains, refresh the count if it deleted anything —
  // fired from BOTH the success and error paths, so a committed delete still
  // refreshes even when a later update in the same batch fails.
  const flushDeletedBatch = useCallback(() => {
    if (pendingOpsRef.current !== 0 || !batchHadDeleteRef.current) return;
    batchHadDeleteRef.current = false;
    onRecordsDeletedRef.current?.();
  }, []);

  const handleSyncSuccess = useCallback(() => {
    pendingOpsRef.current = Math.max(0, pendingOpsRef.current - 1);
    if (pendingOpsRef.current === 0) {
      markSaved();
      flushDeletedBatch();
    }
  }, [flushDeletedBatch, markSaved]);

  const handleSyncError = useCallback(
    (error: { message: string }) => {
      pendingOpsRef.current = Math.max(0, pendingOpsRef.current - 1);
      onStatusRef.current("error", error.message);
      flushDeletedBatch();
    },
    [flushDeletedBatch],
  );

  // Drain pending changes to the DB (debounced)
  useEffect(() => {
    if (!projectId) return;

    const datasetsToSync = Object.keys(pendingSavedChanges);
    if (datasetsToSync.length === 0) return;

    const timeoutId = setTimeout(() => {
      syncPendingDatasets({
        projectId,
        datasetIds: datasetsToSync,
        pending: pendingChangesRef.current,
        deleteMutation: deleteRef.current,
        updateMutation: updateRef.current,
        resolveFullRecord: resolveFullRecordRef.current,
        clearPendingChange,
        start: handleSyncStart,
        succeed: handleSyncSuccess,
        fail: handleSyncError,
        markDeleted: () => {
          batchHadDeleteRef.current = true;
        },
      });
    }, DATASET_SYNC_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [
    pendingSavedChanges,
    projectId,
    clearPendingChange,
    handleSyncStart,
    handleSyncSuccess,
    handleSyncError,
  ]);
};

type RecordSyncMutations = {
  deleteMutation: Pick<
    ReturnType<typeof datasetApi.datasetRecord.deleteMany.useMutation>,
    "mutate"
  >;
  updateMutation: Pick<ReturnType<typeof datasetApi.datasetRecord.update.useMutation>, "mutate">;
};

/** Which of one dataset's pending changes are deletions and which are full-record updates. */
function splitRecordChanges(recordChanges: NonNullable<PendingSavedChanges[string]>): {
  recordsToDelete: string[];
  recordsToUpdate: string[];
} {
  const recordsToDelete: string[] = [];
  const recordsToUpdate: string[] = [];
  for (const [recordId, changes] of Object.entries(recordChanges)) {
    if (!changes || Object.keys(changes).length === 0) continue;
    if ("_delete" in changes && changes._delete === true) recordsToDelete.push(recordId);
    else recordsToUpdate.push(recordId);
  }
  return { recordsToDelete, recordsToUpdate };
}

/** Drains every named dataset's pending changes, one dataset at a time. */
function syncPendingDatasets({
  datasetIds,
  pending,
  ...rest
}: Omit<Parameters<typeof syncDatasetChanges>[0], "dbDatasetId" | "recordChanges"> & {
  datasetIds: string[];
  pending: PendingSavedChanges;
}): void {
  for (const dbDatasetId of datasetIds) {
    syncDatasetChanges({ ...rest, dbDatasetId, recordChanges: pending[dbDatasetId] });
  }
}

/** Drains one dataset's pending changes: one batch delete, then a full-record update each. */
function syncDatasetChanges({
  projectId,
  dbDatasetId,
  recordChanges,
  deleteMutation,
  updateMutation,
  resolveFullRecord,
  clearPendingChange,
  start,
  succeed,
  fail,
  markDeleted,
}: RecordSyncMutations & {
  projectId: string;
  dbDatasetId: string;
  recordChanges: PendingSavedChanges[string] | undefined;
  resolveFullRecord: DatasetRecordSyncParams["resolveFullRecord"];
  clearPendingChange: DatasetRecordSyncParams["clearPendingChange"];
  start: () => void;
  succeed: () => void;
  fail: (error: { message: string }) => void;
  markDeleted: () => void;
}): void {
  if (!recordChanges) return;
  const { recordsToDelete, recordsToUpdate } = splitRecordChanges(recordChanges);

  if (recordsToDelete.length > 0) {
    start();
    deleteMutation.mutate(
      { projectId, datasetId: dbDatasetId, recordIds: recordsToDelete },
      {
        onSuccess: () => {
          for (const recordId of recordsToDelete) clearPendingChange(dbDatasetId, recordId);
          // Mark before draining: if this delete is the batch's last op, the
          // success handler fires the count refresh in this same call.
          markDeleted();
          succeed();
        },
        onError: (error) => {
          console.error("Failed to delete saved records:", error);
          fail(error);
        },
      },
    );
  }

  for (const recordId of recordsToUpdate) {
    // Send the full record: the backend replaces the entire entry
    const fullRecord = resolveFullRecord(dbDatasetId, recordId);
    if (!fullRecord) continue;

    const { id: _id, ...recordData } = fullRecord;
    start();
    updateMutation.mutate(
      { projectId, datasetId: dbDatasetId, recordId, updatedRecord: recordData },
      {
        onSuccess: () => {
          clearPendingChange(dbDatasetId, recordId);
          succeed();
        },
        onError: (error) => {
          console.error("Failed to sync saved record:", error);
          fail(error);
        },
      },
    );
  }
}
