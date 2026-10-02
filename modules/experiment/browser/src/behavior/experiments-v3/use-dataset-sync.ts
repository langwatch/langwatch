import type { UiDatasetRecordSyncProps } from "@langwatch/browser-host/declarations";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { useCallback } from "react";

import type { AutosaveState } from "../../model/dataset/dataset-table-context.tsx";
import type { DatasetReference } from "../../model/experiments-v3/types.ts";
import { useEvaluationsV3Store } from "./use-evaluations-v3-store.ts";

/**
 * What dataset's lent record sync needs from the workbench store: full records
 * resolved out of the store's dataset state, and status into its autosave indicator.
 */
export const useDatasetSyncProps = (): UiDatasetRecordSyncProps => {
  const { project } = useOrganizationTeamProject();

  const { datasets, pendingSavedChanges, clearPendingChange, setAutosaveStatus } =
    useEvaluationsV3Store((state) => ({
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
          savedRecords: ({ id: string } & Record<string, string>)[];
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

  return {
    projectId: project?.id,
    pendingSavedChanges,
    resolveFullRecord,
    clearPendingChange,
    onStatus,
  };
};
