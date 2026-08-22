import {
  type SetCellValuePayload,
  setCellValuePayloadSchema,
} from "../schemas";
import { replaceDataset, requireInlineDataset } from "./helpers";
import type { Transform } from "./types";

/**
 * Write one cell of an inline dataset.
 *
 * Short columns are padded with empty strings up to the row being written, so a
 * value can land past the end of a ragged column.
 */
export const setCellValue: Transform<
  SetCellValuePayload,
  { datasetId: string; rowIndex: number }
> = ({ state, payload }) => {
  const { datasetId, rowIndex, columnId, value } =
    setCellValuePayloadSchema.parse(payload);
  const dataset = requireInlineDataset({ state, datasetId });

  const columnValues = [...(dataset.inline.records[columnId] ?? [])];
  while (columnValues.length <= rowIndex) {
    columnValues.push("");
  }
  columnValues[rowIndex] = value;

  return {
    state: replaceDataset({
      state,
      dataset: {
        ...dataset,
        inline: {
          ...dataset.inline,
          records: { ...dataset.inline.records, [columnId]: columnValues },
        },
      },
    }),
    result: { datasetId, rowIndex },
  };
};
