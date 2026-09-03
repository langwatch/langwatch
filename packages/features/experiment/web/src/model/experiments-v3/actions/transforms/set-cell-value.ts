import { type SetCellValuePayload, setCellValuePayloadSchema } from "../schemas";
import { inlineRowCount, replaceDataset, requireInlineDataset } from "./helpers";
import { type Transform, TransformError } from "./types";

/**
 * Write one cell of an inline dataset.
 *
 * The column has to exist on the dataset: writing to an unknown column id would
 * add a record the table never shows, so the value would be invisible and the
 * write would still report success.
 *
 * Every column is padded with empty strings up to the row being written, not
 * only the one that takes the value. The table reads a row across all columns,
 * so padding one column alone would put the new value on a row the other
 * columns do not have, and the run would read the cells beside it as missing.
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
