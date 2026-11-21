import { isDeepStrictEqual } from "node:util";

import {
  DatasetRecordConflictError,
  type CreateDatasetRecordsInput,
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
    verifyDatasetRecordEntry({ id, entry, storedEntry: byId.get(id) });
  }
}

function verifyDatasetRecordEntry(input: {
  id: string;
  entry: unknown;
  storedEntry: unknown;
}): void {
  if (!isDeepStrictEqual(input.entry, input.storedEntry)) {
    throw new DatasetRecordConflictError(input.id);
  }
}

export function verifyExistingDatasetRecords(input: {
  records: readonly { id: string; entry: unknown }[];
  stored: readonly { id?: string; entry: unknown }[];
}): void {
  const byId = new Map(input.stored.map((record) => [record.id, record.entry]));
  for (const record of input.records) {
    if (byId.has(record.id)) {
      verifyDatasetRecordEntry({
        id: record.id,
        entry: record.entry,
        storedEntry: byId.get(record.id),
      });
    } else {
      byId.set(record.id, record.entry);
    }
  }
}

/** Read existing rows only when the caller supplied every ID and requested readback. */
export function datasetRecordReadback(
  input: CreateDatasetRecordsInput,
): { kind: "written" } | { kind: "existing"; ids: string[] } {
  if (!input.readBackExisting) return { kind: "written" };

  const ids = input.entries.flatMap((entry) => (entry.id === void 0 ? [] : [entry.id]));
  return ids.length === input.entries.length ? { kind: "existing", ids } : { kind: "written" };
}
