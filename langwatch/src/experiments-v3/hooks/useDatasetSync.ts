import { useCallback } from "react";
import type { AutosaveState } from "~/components/datasets/editor/DatasetTableContext";
import { useDatasetRecordSync } from "~/components/datasets/editor/useDatasetRecordSync";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { DatasetReference } from "../types";
import { useEvaluationsV3Store } from "./useEvaluationsV3Store";

/**
 * Syncs saved dataset record changes from the workbench store to the
 * database. Thin adapter over the shared useDatasetRecordSync: resolves full
 * records out of the store's dataset state and reports status into the
 * store's autosave indicator.
 */
export const useDatasetSync = () => {
  const { project } = useOrganizationTeamProject();

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

  const resolveFullRecord = useCallback(
    (dbDatasetId: string, recordId: string) => {
      const dataset = datasets.find(
        (
          d,
        ): d is DatasetReference & {
          type: "saved";
          savedRecords: Array<{ id: string } & Record<string, string>>;
        } => d.type === "saved" && d.datasetId === dbDatasetId,
      );
      return dataset?.savedRecords?.find((r) => r.id === recordId);
    },
    [datasets],
  );

  const onStatus = useCallback(
    (state: AutosaveState, error?: string) => {
      setAutosaveStatus("dataset", state, error);
    },
    [setAutosaveStatus],
  );

  useDatasetRecordSync({
    projectId: project?.id,
    pendingSavedChanges,
    resolveFullRecord,
    clearPendingChange,
    onStatus,
  });
};
