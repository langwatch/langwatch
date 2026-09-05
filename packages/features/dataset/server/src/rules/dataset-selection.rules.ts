import type { DatasetEntrySelection, DatasetRecord } from "@langwatch/dataset-contract";
import { stripNullBytes } from "./dataset-sanitize.rules";

/** The url-safe name a dataset is addressed by. */
export function datasetSlugOf(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replaceAll(/[^\p{L}\p{N}]+/gu, "-")
    .replaceAll(/^-+|-+$/g, "")
    .toLowerCase();

  return slug || "dataset";
}

/** Whether the record read failed because the row is not there. */
export function isDatasetRecordNotFound(error: unknown): boolean {
  return error instanceof Error && error.name === "DatasetRecordNotFoundError";
}

/** The records a selection names: all of them, or exactly one. */
export function selectDatasetRecords(
  records: DatasetRecord[],
  selection: DatasetEntrySelection,
): DatasetRecord[] {
  if (selection === "all") {
    return records;
  }

  if (records.length === 0) {
    return [];
  }

  const index =
    selection === "first"
      ? 0
      : selection === "last"
        ? records.length - 1
        : selection === "random"
          ? Math.floor(Math.random() * records.length)
          : Math.min(Math.max(selection, 0), records.length - 1);

  return [records[index]!];
}

/** Records up to a byte budget, and whether the budget cut the list short. */
export function limitDatasetRecordsByBytes(
  records: DatasetRecord[],
  limitMb: number | null,
): { records: DatasetRecord[]; truncated: boolean } {
  if (limitMb === null) {
    return { records, truncated: false };
  }

  const limitBytes = limitMb * 1024 * 1024;
  let bytes = 0;
  const result: DatasetRecord[] = [];
  for (const record of records) {
    const recordBytes = JSON.stringify(record.entry).length;
    if (bytes + recordBytes >= limitBytes) {
      return { records: result, truncated: true };
    }

    bytes += recordBytes;
    result.push(record);
  }

  return { records: result, truncated: false };
}

/**
 * Postgres jsonb cannot hold U+0000, so a customer-supplied entry is scrubbed before it
 * reaches the inline record table. The s3_jsonl paths scrub in the chunk writer instead.
 */
export function sanitizedEntry(entry: Record<string, unknown>): Record<string, unknown> {
  return stripNullBytes(entry) as Record<string, unknown>;
}
