import { isDeepStrictEqual } from "node:util";

import {
  DatasetRecordConflictError,
  type DatasetRecord,
  type DatasetRecordInput,
} from "@langwatch/dataset-contract";

/** Compare the full normalized entry, including columns removed from a mapping. */
export function verifyDatasetRecords(
  entries: (DatasetRecordInput & { id: string })[],
  stored: DatasetRecord[],
): void {
  const byId = new Map(stored.map((record) => [record.id, record.entry]));
  for (const { id, ...entry } of entries) {
    if (!isDeepStrictEqual(entry, byId.get(id))) {
      throw new DatasetRecordConflictError(id);
    }
  }
}
