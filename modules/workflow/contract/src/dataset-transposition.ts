import { generate } from "@langwatch/ksuid";

import type { DatasetRecordEntry } from "@langwatch/dataset-contract";

/**
 * The app's KSUID resource for an inline dataset row (`KSUID_RESOURCES.RECORD`).
 * The literal, not the constant table: an inline row never reaches a
 * database, but the kind still says what the id is for.
 */
const RECORD_KSUID_RESOURCE = "record";

/**
 * Converts column-first inline dataset to row-first records; values stay unknown.
 */
export function transposeColumnsFirstToRowsFirstWithId(
  data: Record<string, unknown[]>,
): DatasetRecordEntry[] {
  const rows: DatasetRecordEntry[] = [];

  for (const [column, values] of Object.entries(data)) {
    for (const [index, value] of values.entries()) {
      const row: DatasetRecordEntry = rows[index] ?? {
        id: generate(RECORD_KSUID_RESOURCE).toString(),
      };
      row[column] = value;
      rows[index] = row;
    }
  }

  return rows;
}
