import { type AddRowsPayload, addRowsPayloadSchema } from "../schemas";
import { inlineRowCount, replaceDataset, requireInlineDataset } from "./helpers";
import type { Transform } from "./types";

const paddedTo = ({ values, length }: { values: string[]; length: number }): string[] => {
  const padded = [...values];
  while (padded.length < length) {
    padded.push("");
  }
  return padded;
};

/**
 * Append rows to an inline dataset.
 *
 * Inline records are stored column-first (`records[columnId] = values[]`), so a
 * row-shaped input is transposed here. Every column is first padded to the
 * current row count, so ragged columns stay aligned, and a value missing from a
 * row becomes an empty cell rather than a hole. Row keys accept a column id or
 * a column name, because that is what a caller reading the table sees.
 */
export const addRows: Transform<
  AddRowsPayload,
  { datasetId: string; addedRows: number; rowCount: number }
> = ({ state, payload }) => {
  const { datasetId, rows } = addRowsPayloadSchema.parse(payload);
  const dataset = requireInlineDataset({ state, datasetId });

  const startRowCount = inlineRowCount(dataset.inline);
  const records: Record<string, string[]> = {};

  for (const column of dataset.inline.columns) {
    const values = paddedTo({
      values: dataset.inline.records[column.id] ?? [],
      length: startRowCount,
    });
    for (const row of rows) {
      values.push(row[column.id] ?? row[column.name] ?? "");
    }
    records[column.id] = values;
  }

  // Keep any column that only exists in the records (never surfaced by the
  // table, but dropping it here would lose data). It grows with the rest: a
  // caller cannot address it, so its new cells are empty, and leaving it short
  // would write ragged records.
  for (const [columnId, values] of Object.entries(dataset.inline.records)) {
    if (records[columnId]) continue;
    records[columnId] = paddedTo({
      values,
      length: startRowCount + rows.length,
    });
  }

  return {
    state: replaceDataset({
      state,
      dataset: {
        ...dataset,
        inline: { ...dataset.inline, records },
      },
    }),
    result: {
      datasetId,
      addedRows: rows.length,
      rowCount: startRowCount + rows.length,
    },
  };
};
