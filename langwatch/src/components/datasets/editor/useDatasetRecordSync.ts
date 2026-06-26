/**
 * Debounced sync of locally-edited dataset records to the database.
 *
 * Owners of dataset state (the evaluations workbench store, the standalone
 * dataset editor) accumulate pending changes keyed by database dataset id and
 * record id; this hook drains them: updates go through datasetRecord.update
 * with the FULL record (the backend replaces the whole entry), deletions are
 * marked with `_delete: true` and go through datasetRecord.deleteMany.
 *
 * Save status is reported through onStatus so each surface can render its own
 * autosave indicator. A failed sync keeps the pending change around, so a
 * retry happens on the next edit; it must always be VISIBLE; never report
 * silent success on error.
 */
import { useCallback, useEffect, useRef } from "react";

import { api } from "~/utils/api";
import type { AutosaveState } from "./DatasetTableContext";

export const DATASET_SYNC_DEBOUNCE_MS = 500;

/** pendingChanges shape: dbDatasetId -> recordId -> column changes.
 *  A record with `_delete: true` is a pending deletion. */
export type PendingSavedChanges = Record<
  string,
  Record<string, Record<string, unknown>>
>;

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
  const updateSavedRecord = api.datasetRecord.update.useMutation();
  const deleteSavedRecords = api.datasetRecord.deleteMany.useMutation();
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

  const handleSyncSuccess = useCallback(() => {
    pendingOpsRef.current = Math.max(0, pendingOpsRef.current - 1);
    if (pendingOpsRef.current === 0) {
      markSaved();
      if (batchHadDeleteRef.current) {
        batchHadDeleteRef.current = false;
        onRecordsDeletedRef.current?.();
      }
    }
  }, [markSaved]);

  const handleSyncError = useCallback((error: { message: string }) => {
    pendingOpsRef.current = Math.max(0, pendingOpsRef.current - 1);
    onStatusRef.current("error", error.message);
  }, []);

  // Drain pending changes to the DB (debounced)
  useEffect(() => {
    if (!projectId) return;

    const datasetsToSync = Object.keys(pendingSavedChanges);
    if (datasetsToSync.length === 0) return;

    const timeoutId = setTimeout(() => {
      for (const dbDatasetId of datasetsToSync) {
        const recordChanges = pendingChangesRef.current[dbDatasetId];
        if (!recordChanges) continue;

        const recordsToDelete: string[] = [];
        const recordsToUpdate: string[] = [];

        for (const [recordId, changes] of Object.entries(recordChanges)) {
          if (!changes || Object.keys(changes).length === 0) continue;

          if ("_delete" in changes && changes._delete === true) {
            recordsToDelete.push(recordId);
          } else {
            recordsToUpdate.push(recordId);
          }
        }

        if (recordsToDelete.length > 0) {
          handleSyncStart();
          deleteRef.current.mutate(
            {
              projectId,
              datasetId: dbDatasetId,
              recordIds: recordsToDelete,
            },
            {
              onSuccess: () => {
                for (const recordId of recordsToDelete) {
                  clearPendingChange(dbDatasetId, recordId);
                }
                // Mark before draining: if this delete is the batch's last op,
                // handleSyncSuccess fires the count refresh in this same call.
                batchHadDeleteRef.current = true;
                handleSyncSuccess();
              },
              onError: (error) => {
                console.error("Failed to delete saved records:", error);
                handleSyncError(error);
              },
            },
          );
        }

        for (const recordId of recordsToUpdate) {
          // Send the full record: the backend replaces the entire entry
          const fullRecord = resolveFullRecordRef.current(
            dbDatasetId,
            recordId,
          );
          if (!fullRecord) continue;

          const { id: _id, ...recordData } = fullRecord;

          handleSyncStart();
          updateRef.current.mutate(
            {
              projectId,
              datasetId: dbDatasetId,
              recordId,
              updatedRecord: recordData,
            },
            {
              onSuccess: () => {
                clearPendingChange(dbDatasetId, recordId);
                handleSyncSuccess();
              },
              onError: (error) => {
                console.error("Failed to sync saved record:", error);
                handleSyncError(error);
              },
            },
          );
        }
      }
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
