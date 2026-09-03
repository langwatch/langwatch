import { nanoid } from "nanoid";

import type { DatasetRecordEntry } from "@langwatch/dataset-contract";

/**
 * Turns a column-first inline dataset into the row-first records the editor
 * and the executor read.
 *
 * The values stay `unknown`: an inline dataset column can be any
 * `DatasetColumnType` (`number`, `boolean`, `json`, `spans`, …), the parsed
 * `NodeDataset.inline.records` is `Record<string, unknown[]>`, and
 * `DatasetRecordEntry` holds `unknown` too — so nothing here narrows to
 * strings, and declaring that it did only made every caller's real data
 * unassignable.
 */
export function transposeColumnsFirstToRowsFirstWithId(
  data: Record<string, unknown[]>,
): DatasetRecordEntry[] {
  const rows: DatasetRecordEntry[] = [];

  for (const [column, values] of Object.entries(data)) {
    for (const [index, value] of values.entries()) {
      const row: DatasetRecordEntry = rows[index] ?? { id: nanoid() };
      row[column] = value;
      rows[index] = row;
    }
  }

  return rows;
}
