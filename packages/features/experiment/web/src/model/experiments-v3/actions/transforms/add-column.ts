import type { DatasetColumn } from "../../types";
import { type AddColumnPayload, addColumnPayloadSchema } from "../schemas";
import { inlineRowCount, replaceDataset, requireInlineDataset } from "./helpers";
import { type Transform, TransformError } from "./types";

/**
 * Add a column to an inline dataset.
 *
 * The column lands on both the dataset reference and the inline block (the
 * table reads the first, execution reads the second), pre-filled with empty
 * values for every existing row so the column is never shorter than the others.
 */
export const addColumn: Transform<AddColumnPayload, { datasetId: string; columnId: string }> = ({
  state,
  payload,
}) => {
  const { datasetId, column } = addColumnPayloadSchema.parse(payload);
  const dataset = requireInlineDataset({ state, datasetId });

  // Blank is not an id: an empty or whitespace-only one falls back to the name,
  // the same as sending none. A blank id reaching state would key the records
  // block on "" and the column would never find its own values again.
  const newColumn = {
    ...column,
    id: column.id?.trim() || column.name,
  } as DatasetColumn;

  const taken = dataset.inline.columns.some(
    (c) => c.id === newColumn.id || c.name === newColumn.name,
  );
  if (taken) {
    throw new TransformError({
      code: "column_already_exists",
      message: `Dataset ${datasetId} already has a column ${newColumn.name}`,
      meta: { datasetId, columnId: newColumn.id, name: newColumn.name },
    });
  }

  const emptyValues = Array(inlineRowCount(dataset.inline)).fill("") as string[];

  return {
    state: replaceDataset({
      state,
      dataset: {
        ...dataset,
        columns: [...dataset.columns, newColumn],
        inline: {
          ...dataset.inline,
          columns: [...dataset.inline.columns, newColumn],
          records: { ...dataset.inline.records, [newColumn.id]: emptyValues },
        },
      },
    }),
    result: { datasetId, columnId: newColumn.id },
  };
};
