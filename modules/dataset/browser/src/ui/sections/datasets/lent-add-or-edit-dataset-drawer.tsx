/** Dataset's create-or-edit drawer, lent to other modules (ARCHITECTURE.md §3.4, rule 7). */

import type { UiAddOrEditDatasetDrawerProps } from "@langwatch/browser-host/declarations";
import { datasetColumnsSchema } from "@langwatch/dataset-contract";

import { AddOrEditDatasetDrawer } from "./add-or-edit-dataset-drawer.tsx";

/** The drawer over a borrower's plain columns, read through the dataset contract. */
export function LentAddOrEditDatasetDrawer({
  datasetToSave,
  ...props
}: UiAddOrEditDatasetDrawerProps) {
  return (
    <AddOrEditDatasetDrawer
      {...props}
      datasetToSave={
        datasetToSave
          ? { ...datasetToSave, columnTypes: datasetColumnsSchema.parse(datasetToSave.columnTypes) }
          : undefined
      }
    />
  );
}
