import type { DatasetEntrySelection, DatasetRecord } from "@langwatch/dataset-contract";

import { entryBytesOf } from "./dataset-row-limits.rules.ts";
import { stripNullBytes } from "./dataset-sanitize.rules.ts";

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

  if (selection === "first") {
    return [records[0]!];
  }

  if (selection === "last") {
    return [records[records.length - 1]!];
  }

  if (selection === "random") {
    return [records[Math.floor(Math.random() * records.length)]!];
  }

  const index = Math.min(Math.max(selection, 0), records.length - 1);

  return [records[index]!];
}

/**
 * Records up to a byte budget, in order, and whether the budget left any out.
 * The same rule on every storage layout: a row is kept while the rows before
 * it and the row itself fit, and the first row that does not fit ends the read.
 */
export function limitDatasetRecordsByBytes(
  records: DatasetRecord[],
  limitBytes: number,
): { records: DatasetRecord[]; truncated: boolean } {
  let bytes = 0;
  const result: DatasetRecord[] = [];
  for (const record of records) {
    bytes += entryBytesOf(record.entry);
    if (bytes > limitBytes) {
      return { records: result, truncated: true };
    }

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
