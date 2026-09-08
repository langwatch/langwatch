/**
 * Which of a target's inputs may hold an uploaded attachment: a cell value is a
 * plain string whatever the column holds, so the dataset column's type decides.
 * @see specs/experiments-v3/dataset-attachments.feature
 */

import type { ExecutionCell } from "@langwatch/experiment-contract";

/** The dataset column types whose value is an attachment, not prose. */
const ATTACHMENT_COLUMN_TYPES = new Set(["image", "file"]);

/**
 * The input identifiers of a cell that read from an `image` or `file` dataset
 * column, in the order the target declares its mappings.
 */
export function attachmentInputFields({
  cell,
  datasetColumns,
}: {
  cell: ExecutionCell;
  datasetColumns: Array<{ id: string; name: string; type: string }>;
}): string[] {
  const datasetId = cell.datasetEntry._datasetId as string | undefined;
  if (!datasetId) {
    return [];
  }

  const typeByColumnName = new Map(datasetColumns.map((column) => [column.name, column.type]));
  const mappings = cell.targetConfig.mappings[datasetId] ?? {};

  return Object.entries(mappings)
    .filter(([, mapping]) => mapping.type === "source" && mapping.source === "dataset")
    .filter(([, mapping]) => {
      const columnType = typeByColumnName.get((mapping as { sourceField: string }).sourceField);

      return columnType !== undefined && ATTACHMENT_COLUMN_TYPES.has(columnType);
    })
    .map(([inputField]) => inputField);
}
