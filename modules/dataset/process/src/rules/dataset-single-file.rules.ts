import { z } from "zod";

import { assertNoTraversal } from "./dataset-chunking.rules.ts";

/** One record as the previous release stored it; its other fields are kept as they were. */
const singleFileRecordSchema = z.looseObject({
  id: z.string().optional(),
  entry: z.record(z.string(), z.unknown()),
});

export type SingleFileRecord = z.infer<typeof singleFileRecordSchema>;

type DatasetKey = { projectId: string; datasetId: string };

/** A dataset the previous release kept as one JSON array: `useS3` on the postgres layout. */
export function isSingleFileDataset(dataset: { useS3: boolean; contentLayout: string }): boolean {
  return dataset.useS3 && dataset.contentLayout === "postgres";
}

/** The previous release's object key for a single-file dataset (its `storage.ts`). */
export function singleFileKey(input: DatasetKey): string {
  assertNoTraversal(input.projectId, input.datasetId);
  return `datasets/${input.projectId}/${input.datasetId}`;
}

/** A single-file dataset's records in stored order, or `unreadable` when not that array. */
export function parseSingleFileRecords(
  text: string,
): { outcome: "parsed"; records: SingleFileRecord[] } | { outcome: "unreadable" } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { outcome: "unreadable" };
  }
  const parsed = z.array(singleFileRecordSchema).safeParse(json);
  return parsed.success ? { outcome: "parsed", records: parsed.data } : { outcome: "unreadable" };
}

/** The timestamps the previous release stored with each record it wrote. */
export const storedRecordTimestampsSchema = z.object({
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

/** New records after the stored ones, in the shape and positions the previous release wrote. */
export function appendSingleFileRecords(
  input: DatasetKey & {
    records: readonly SingleFileRecord[];
    added: readonly { id: string; entry: Record<string, unknown> }[];
    now: string;
  },
): SingleFileRecord[] {
  const added = input.added.map((record, index) => ({
    id: record.id,
    entry: record.entry,
    datasetId: input.datasetId,
    createdAt: input.now,
    updatedAt: input.now,
    projectId: input.projectId,
    position: (index + 1) * 1000,
  }));
  return [...input.records, ...added];
}

/** The record with this id given the new entry, or a new record appended when none has it. */
export function upsertSingleFileRecord(
  input: DatasetKey & {
    records: readonly SingleFileRecord[];
    recordId: string;
    entry: Record<string, unknown>;
    now: string;
  },
): { records: SingleFileRecord[]; created: boolean } {
  const at = input.records.findIndex((record) => record.id === input.recordId);
  if (at === -1) {
    const created = {
      id: input.recordId,
      entry: input.entry,
      datasetId: input.datasetId,
      projectId: input.projectId,
      createdAt: input.now,
      updatedAt: input.now,
    };
    return { records: [...input.records, created], created: true };
  }
  const records = input.records.map((record, index) =>
    index === at ? { ...record, entry: input.entry, updatedAt: input.now } : record,
  );
  return { records, created: false };
}

/** The stored records without the named ids, and how many were removed. */
export function removeSingleFileRecords(input: {
  records: readonly SingleFileRecord[];
  recordIds: readonly string[];
}): { records: SingleFileRecord[]; deleted: number } {
  const removing = new Set(input.recordIds);
  const records = input.records.filter(
    (record) => record.id === undefined || !removing.has(record.id),
  );
  return { records, deleted: input.records.length - records.length };
}
