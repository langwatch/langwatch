import { useCallback, useEffect, useRef } from "react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import type { DatasetReference } from "../types";
import { useEvaluationsV3Store } from "./useEvaluationsV3Store";

/**
 * Hook to sync saved dataset record changes to the database.
 * Handles both updates and deletions with debouncing.
 * Updates autosave status in the store.
 */
export const useDatasetSync = () => {
  const { project } = useOrganizationTeamProject();
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingOpsRef = useRef(0);

  const {
    datasets,
    pendingSavedChanges,
    clearPendingChange,
    setAutosaveStatus,
  } = useEvaluationsV3Store((state) => ({
    datasets: state.datasets,
    pendingSavedChanges: state.pendingSavedChanges,
    clearPendingChange: state.clearPendingChange,
    setAutosaveStatus: state.setAutosaveStatus,
  }));

  // Mutations for saved dataset records
  const updateSavedRecord = api.datasetRecord.update.useMutation();
  const deleteSavedRecords = api.datasetRecord.deleteMany.useMutation();

  // Refs to avoid stale closures in the debounced effect
  const pendingChangesRef = useRef(pendingSavedChanges);
  pendingChangesRef.current = pendingSavedChanges;
  const datasetsRef = useRef(datasets);
  datasetsRef.current = datasets;

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (savedTimeoutRef.current) {
        clearTimeout(savedTimeoutRef.current);
      }
    };
  }, []);

  // Transition to "saved" then back to "idle" after delay
  const markSaved = useCallback(() => {
    setAutosaveStatus("dataset", "saved");
    if (savedTimeoutRef.current) {
      clearTimeout(savedTimeoutRef.current);
    }
    savedTimeoutRef.current = setTimeout(() => {
      setAutosaveStatus("dataset", "idle");
    }, 2000);
  }, [setAutosaveStatus]);

  const handleSyncStart = useCallback(() => {
    pendingOpsRef.current += 1;
    setAutosaveStatus("dataset", "saving");
  }, [setAutosaveStatus]);

  const handleSyncSuccess = useCallback(() => {
    pendingOpsRef.current = Math.max(0, pendingOpsRef.current - 1);
    if (pendingOpsRef.current === 0) {
      markSaved();
    }
  }, [markSaved]);

  const handleSyncError = useCallback(
    (error: { message: string }) => {
      pendingOpsRef.current = Math.max(0, pendingOpsRef.current - 1);
      setAutosaveStatus("dataset", "error", error.message);
    },
    [setAutosaveStatus],
  );

  // Effect to sync pending changes to DB (debounced)
  useEffect(() => {
    if (!project?.id) return;

    // Find datasets and records that need syncing
    const datasetsToSync = Object.keys(pendingSavedChanges);
    if (datasetsToSync.length === 0) return;

    // Debounce sync to avoid too many requests
    const timeoutId = setTimeout(() => {
      for (const dbDatasetId of datasetsToSync) {
        const recordChanges = pendingChangesRef.current[dbDatasetId];
        if (!recordChanges) continue;

        // Find the dataset in our state to get the full record data
        const dataset = datasetsRef.current.find(
          (
            d,
          ): d is DatasetReference & {
            type: "saved";
            savedRecords: Array<{ id: string } & Record<string, string>>;
          } => d.type === "saved" && d.datasetId === dbDatasetId,
        );

        // Separate deletions from updates
        const recordsToDelete: string[] = [];
        const recordsToUpdate: Array<{
          recordId: string;
          changes: Record<string, unknown>;
        }> = [];

        for (const [recordId, changes] of Object.entries(recordChanges)) {
          if (!changes || Object.keys(changes).length === 0) continue;

          if ("_delete" in changes && changes._delete === true) {
            recordsToDelete.push(recordId);
          } else {
            recordsToUpdate.push({ recordId, changes });
          }
        }

        // Handle deletions
        if (recordsToDelete.length > 0) {
          handleSyncStart();
          deleteSavedRecords.mutate(
            {
              projectId: project.id,
              datasetId: dbDatasetId,
              recordIds: recordsToDelete,
            },
            {
              onSuccess: () => {
                for (const recordId of recordsToDelete) {
                  clearPendingChange(dbDatasetId, recordId);
                }
                handleSyncSuccess();
              },
              onError: (error) => {
                console.error("Failed to delete saved records:", error);
                handleSyncError(error);
              },
            },
          );
        }

        // Handle updates
        if (dataset?.savedRecords && recordsToUpdate.length > 0) {
          for (const { recordId } of recordsToUpdate) {
            // Find the full record to send all columns (backend replaces entire entry)
            const fullRecord = dataset.savedRecords.find(
              (r) => r.id === recordId,
            );
            if (!fullRecord) continue;

            // Build the full record data (excluding the 'id' field which is metadata)
            const { id: _id, ...recordData } = fullRecord;

            handleSyncStart();
            // Sync this record to DB with full data
            updateSavedRecord.mutate(
              {
                projectId: project.id,
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
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timeoutId);
  }, [
    pendingSavedChanges,
    project?.id,
    updateSavedRecord,
    deleteSavedRecords,
    clearPendingChange,
    handleSyncStart,
    handleSyncSuccess,
    handleSyncError,
  ]);
};
