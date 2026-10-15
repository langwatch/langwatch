/** Dataset's editor table, lent to other modules (ARCHITECTURE.md §3.4, rule 7). */

import type { DatasetEditorTableProps } from "@langwatch/dataset-client";
import { datasetColumnsSchema } from "@langwatch/dataset-contract";

import { DatasetEditorTable } from "./editor/dataset-editor-table.tsx";

/** The editor over a borrower's plain in-memory dataset, read through the dataset contract. */
export function LentDatasetEditorTable({ inMemoryDataset, ...props }: DatasetEditorTableProps) {
  return (
    <DatasetEditorTable
      {...props}
      inMemoryDataset={
        inMemoryDataset
          ? {
              ...inMemoryDataset,
              columnTypes: datasetColumnsSchema.parse(inMemoryDataset.columnTypes),
            }
          : undefined
      }
    />
  );
}
