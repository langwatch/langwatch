import { nanoid } from "nanoid";

import type { DatasetRecordEntry } from "@langwatch/dataset-contract";

/**
 * Converts column-first inline dataset to row-first records; values stay unknown.
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
