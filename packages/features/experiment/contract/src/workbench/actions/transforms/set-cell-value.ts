import { type SetCellValuePayload, setCellValuePayloadSchema } from "../schemas";
import { inlineRowCount, replaceDataset, requireInlineDataset } from "./helpers";
import { type Transform, TransformError } from "./types";

/**
 * Write one cell of an inline dataset.
 */
export const setCellValue: Transform<
  SetCellValuePayload,
  { datasetId: string; rowIndex: number }
> = ({ state, payload }) => {
  const { datasetId, rowIndex, columnId, value } = setCellValuePayloadSchema.parse(payload);
  const dataset = requireInlineDataset({ state, datasetId });

  if (!dataset.inline.columns.some((column) => column.id === columnId)) {
    throw new TransformError({
      code: "column_not_found",
      message: `Dataset ${datasetId} has no column ${columnId}`,
      meta: { datasetId, columnId },
    });
  }

  const rowCount = Math.max(inlineRowCount(dataset.inline), rowIndex + 1);
  const records: Record<string, string[]> = { ...dataset.inline.records };
  for (const column of dataset.inline.columns) {
    const columnValues = [...(records[column.id] ?? [])];
    while (columnValues.length < rowCount) {
      columnValues.push("");
    }
    records[column.id] = columnValues;
  }
  records[columnId]![rowIndex] = value;

  return {
    state: replaceDataset({
      state,
      dataset: {
        ...dataset,
        inline: { ...dataset.inline, records },
      },
    }),
    result: { datasetId, rowIndex },
  };
};
