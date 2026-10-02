/** The dataset header's actions: pick a saved one, upload a CSV, edit, or save an inline one. */
import { useDrawer } from "@langwatch/browser-host/drawer";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { datasetClient } from "@langwatch/dataset-client";
import type { DatasetColumnType } from "@langwatch/dataset-contract";
import { useMemo } from "react";

import { convertInlineToRowRecords } from "../../model/experiments-v3/dataset-conversion.ts";
import type { DatasetReference } from "../../model/experiments-v3/types.ts";
import type { PendingDatasetLoad } from "./use-saved-dataset-loader.ts";

export type SaveAsDatasetDraft = {
  name: string;
  columnTypes: { name: string; type: DatasetColumnType }[];
  datasetRecords: ({ id?: string } & Record<string, string>)[];
};

/**
 * An inline dataset as the save drawer opens it: its non-empty rows, under the
 * next free name ("Test Data (2)"); the original name if that lookup fails, and
 * the drawer's own validation catches a clash.
 */
const saveAsDraftOf = async ({
  dataset,
  columns,
  nextFreeName,
}: {
  dataset: DatasetReference;
  columns: { name: string; type: string }[];
  nextFreeName: () => Promise<string>;
}): Promise<SaveAsDatasetDraft> => {
  const name = await nextFreeName().catch((error: unknown) => {
    console.warn("Failed to fetch next available name:", error);
    return dataset.name;
  });
  return {
    name,
    columnTypes: columns.map((col) => ({ name: col.name, type: col.type as DatasetColumnType })),
    datasetRecords:
      dataset.type === "inline" && dataset.inline
        ? convertInlineToRowRecords(dataset.inline.columns, dataset.inline.records)
        : [],
  };
};

export const useWorkbenchDatasetHandlers = ({
  loadSavedDataset,
  openEditDrawer,
  openSaveAsDrawer,
}: {
  loadSavedDataset: (dataset: PendingDatasetLoad) => void;
  openEditDrawer: () => void;
  openSaveAsDrawer: (draft: SaveAsDatasetDraft) => void;
}) => {
  const { openDrawer } = useDrawer();
  const { project } = useOrganizationTeamProject();
  const trpcUtils = datasetClient.useUtils();

  return useMemo(
    () => ({
      onSelectExisting: () => {
        openDrawer("selectDataset", {
          onSelect: ({ datasetId, name, columnTypes }: PendingDatasetLoad) =>
            loadSavedDataset({ datasetId, name, columnTypes }),
        });
      },
      onUploadCSV: () => {
        openDrawer("uploadCSV", {
          onSuccess: ({ datasetId, name, columnTypes }: PendingDatasetLoad) =>
            loadSavedDataset({ datasetId, name, columnTypes }),
        });
      },
      onEditDataset: openEditDrawer,
      onSaveAsDataset: async (dataset: DatasetReference) => {
        const projectId = project?.id;
        if (dataset.type !== "inline" || !dataset.inline || !projectId) return;
        openSaveAsDrawer(
          await saveAsDraftOf({
            dataset,
            columns: dataset.inline.columns,
            nextFreeName: () =>
              trpcUtils.dataset.findNextName.fetch({ projectId, proposedName: dataset.name }),
          }),
        );
      },
    }),
    [openDrawer, loadSavedDataset, project?.id, trpcUtils, openEditDrawer, openSaveAsDrawer],
  );
};
