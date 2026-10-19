/**
 * The size one stored row and one page of rows may reach.
 * @see specs/datasets/dataset-limits.feature
 */
import {
  DatasetPageTooLargeError,
  DatasetTooLargeToExportError,
  DatasetRowTooLargeError,
  UploadValidationError,
  formatDatasetByteLimit,
  type DatasetRecord,
} from "@langwatch/dataset-contract";

import { CHUNK_MAX_BYTES } from "./dataset-chunking.rules.ts";

/** The serialized size of one row's values. */
export function entryBytesOf(entry: unknown): number {
  return Buffer.byteLength(JSON.stringify(entry) ?? "", "utf8");
}

/**
 * Refuses a row a dataset cannot store: every row has to fit one chunk, so a
 * later edit of the same row can rewrite it.
 */
export function assertStoredRowWithinLimit(entry: unknown, maxBytes = CHUNK_MAX_BYTES): void {
  if (entryBytesOf(entry) > maxBytes) {
    throw new DatasetRowTooLargeError({ maxBytes, measure: "stored" });
  }
}

/**
 * Refuses a page of records larger than one response carries. A page of one
 * record is always served, so a caller that follows the suggested limit down
 * reaches every row.
 */
export function assertPageWithinLimit(input: {
  records: readonly DatasetRecord[];
  page: number;
  limit: number;
  maxBytes: number;
}): void {
  if (input.records.length <= 1) return;

  let bytes = 0;
  for (const record of input.records) bytes += entryBytesOf(record.entry);
  if (bytes <= input.maxBytes) return;

  throw new DatasetPageTooLargeError({
    maxBytes: input.maxBytes,
    page: input.page,
    limit: input.limit,
    suggestedLimit: suggestedPageLimit(
      input.limit,
      Math.floor((input.records.length * input.maxBytes) / bytes),
    ),
  });
}

/**
 * The largest divisor of `limit` no greater than `target`, so the offset the
 * caller had reached is still a page boundary under the smaller limit.
 */
export function suggestedPageLimit(limit: number, target: number): number {
  for (let candidate = Math.min(Math.max(target, 1), limit - 1); candidate > 1; candidate--) {
    if (limit % candidate === 0) return candidate;
  }

  return 1;
}

/** Refuses a file over the upload limit, naming the limit. */
export function assertUploadFileWithinLimit(sizeBytes: number, maxBytes: number | undefined): void {
  if (maxBytes === undefined || sizeBytes <= maxBytes) return;
  throw new UploadValidationError(
    `The file is larger than the ${formatDatasetByteLimit(maxBytes)} limit for one upload`,
    "file_too_large",
  );
}

/**
 * Refuses a read of every row past what one answer holds in memory, on the
 * size and row count already known: a dataset's recorded ones, or a count.
 */
export function assertWholeReadWithinLimits(input: {
  dataset?: { rowCount: number | null; sizeBytes: bigint | null };
  rowCount?: number;
  maxRows: number;
  maxBytes: number;
}): void {
  const rowCount = input.rowCount ?? input.dataset?.rowCount ?? 0;
  if (rowCount > input.maxRows) {
    throw new DatasetTooLargeToExportError({ rowCount, maxRows: input.maxRows });
  }
  const sizeBytes = input.dataset?.sizeBytes ?? null;
  if (sizeBytes !== null && sizeBytes > BigInt(input.maxBytes)) {
    throw new DatasetTooLargeToExportError({
      sizeBytes: Number(sizeBytes),
      maxBytes: input.maxBytes,
    });
  }
}
