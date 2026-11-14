import { datasetClient } from "@langwatch/dataset-client";
import { createLogger } from "@langwatch/observability/browser";
import { useCallback, useEffect, useRef } from "react";

/**
 * Debounced sync of locally-edited dataset records. Drains pending
 * changes through datasetRecord.update with the FULL record. A failed
 * sync keeps the change for retry — never report silent success.
 */
import type { AutosaveState } from "../../../model/dataset-table-context.tsx";
import type { PendingSavedChanges } from "../../../model/pending-saved-changes.ts";

const logger = createLogger("langwatch:dataset:record-sync");

export const DATASET_SYNC_DEBOUNCE_MS = 500;

/** The code a record write is refused with when a column edit landed after it read the columns. */
const STALE_COLUMNS = "dataset_stale_columns";

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
  /** The dataset's column names in order as this editor holds them, sent so a write keyed
   *  by columns a later edit renamed, removed or swapped is refused. */
  resolveColumns: (dbDatasetId: string) => string[] | undefined;
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
  resolveColumns,
  clearPendingChange,
  onStatus,
  onRecordsDeleted,
}: DatasetRecordSyncParams) => {
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingOpsRef = useRef(0);

  // Mutations stored in refs so mutation state changes (isLoading, etc.)
  // don't re-trigger the sync effect.
  const updateSavedRecord = datasetClient.datasetRecord.update.useMutation();
  const deleteSavedRecords = datasetClient.datasetRecord.deleteMany.useMutation();
  const updateRef = useRef(updateSavedRecord);
  updateRef.current = updateSavedRecord;
  const deleteRef = useRef(deleteSavedRecords);
  deleteRef.current = deleteSavedRecords;

  // Refs to avoid stale closures in the debounced effect
  const pendingChangesRef = useRef(pendingSavedChanges);
  pendingChangesRef.current = pendingSavedChanges;
  const resolveFullRecordRef = useRef(resolveFullRecord);
  resolveFullRecordRef.current = resolveFullRecord;
  const resolveColumnsRef = useRef(resolveColumns);
  resolveColumnsRef.current = resolveColumns;
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
        // Read through the refs: a retry after a refusal needs the record and columns as they are.
        resolveFullRecord: (dbDatasetId, recordId) =>
          resolveFullRecordRef.current(dbDatasetId, recordId),
        resolveColumns: (dbDatasetId) => resolveColumnsRef.current(dbDatasetId),
        currentChange: (dbDatasetId, recordId) =>
          pendingChangesRef.current[dbDatasetId]?.[recordId],
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
    ReturnType<typeof datasetClient.datasetRecord.deleteMany.useMutation>,
    "mutate"
  >;
  updateMutation: Pick<ReturnType<typeof datasetClient.datasetRecord.update.useMutation>, "mutate">;
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

type DatasetChangeSync = RecordSyncMutations & {
  projectId: string;
  dbDatasetId: string;
  recordChanges: PendingSavedChanges[string] | undefined;
  resolveFullRecord: DatasetRecordSyncParams["resolveFullRecord"];
  resolveColumns: DatasetRecordSyncParams["resolveColumns"];
  /** The record's queued change now; a column edit re-keys it into a new object. */
  currentChange: (dbDatasetId: string, recordId: string) => unknown;
  clearPendingChange: DatasetRecordSyncParams["clearPendingChange"];
  start: () => void;
  succeed: () => void;
  fail: (error: { message: string }) => void;
  markDeleted: () => void;
};

/** Drains one dataset's pending changes: one batch delete, then a full-record update each. */
function syncDatasetChanges(sync: DatasetChangeSync): void {
  const { projectId, dbDatasetId, recordChanges, deleteMutation } = sync;
  const { clearPendingChange, start, succeed, fail, markDeleted } = sync;
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
          logger.error({ error }, "Failed to delete saved records");
          fail(error);
        },
      },
    );
  }

  for (const recordId of recordsToUpdate) syncRecordUpdate({ sync, recordId, attempt: 0 });
}

/** Sends one record in full; the backend replaces the entire entry. */
function syncRecordUpdate({
  sync,
  recordId,
  attempt,
}: {
  sync: DatasetChangeSync;
  recordId: string;
  attempt: number;
}): void {
  const { projectId, dbDatasetId, updateMutation, resolveColumns } = sync;
  const fullRecord = sync.resolveFullRecord(dbDatasetId, recordId);
  if (!fullRecord) return;

  const { id: _id, ...recordData } = fullRecord;
  const sentChange = sync.recordChanges?.[recordId];
  const columns = resolveColumns(dbDatasetId);
  sync.start();
  updateMutation.mutate(
    {
      projectId,
      datasetId: dbDatasetId,
      recordId,
      updatedRecord: recordData,
      ...(columns ? { columns } : {}),
    },
    {
      onSuccess: () => {
        sync.clearPendingChange(dbDatasetId, recordId);
        sync.succeed();
      },
      onError: (error) => {
        const stale = error.message === STALE_COLUMNS;
        // A rename re-keyed the queued change, which syncs again under the new names.
        if (stale && sync.currentChange(dbDatasetId, recordId) !== sentChange) {
          sync.succeed();
          return;
        }
        // A reorder moved no values: send the same record once more under the new order.
        const reordered = JSON.stringify(resolveColumns(dbDatasetId)) !== JSON.stringify(columns);
        if (stale && attempt === 0 && reordered) {
          // Start the retry first, so the pending count never reaches zero in between.
          syncRecordUpdate({ sync, recordId, attempt: attempt + 1 });
          sync.succeed();
          return;
        }
        logger.error({ error }, "Failed to sync saved record");
        sync.fail(error);
      },
    },
  );
}
