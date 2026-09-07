/**
 * Pure shape and arithmetic for a dataset stored as `contentLayout='s3_jsonl'` chunks: the
 * `{ id, entry }` line wrapper, the persisted offset index, the readiness gate, and the
 * old-to-new column remap. No storage or database reaches into this module.
 */
import { nanoid } from "nanoid";
import {
  DatasetNotReadyError,
  DuplicateRecordIdError,
  type DatasetColumns,
  type DatasetRecordInput,
} from "@langwatch/dataset-contract";
import { stripNullBytes } from "./dataset-sanitize.rules.ts";
import { type ChunkOffset } from "./dataset-chunking.rules.ts";

/**
 * Storage mutation state shared by the portable Dataset aggregate and the
 * private Prisma row. Mutation code needs these fields, not a generated model.
 */
export type DatasetMutationRecord = {
  id: string;
  status: string;
  statusError: string | null;
  chunkCount: number | null;
  chunkOffsets: unknown;
  rowCount: number | null;
  sizeBytes: bigint | null;
  columnTypes: unknown;
};

/**
 * Byte ceiling for the in-memory column-type rewrite (ADR-032 v19): above this
 * we refuse rather than buffer the whole dataset in heap under the advisory lock.
 * Set above the largest expected hand-edited dataset.
 */
export const MAX_INMEMORY_COLUMN_EDIT_BYTES = 512 * 1024 * 1024;

export type RecomputedDatasetCounts = {
  rowCount: number;
  sizeBytes: number;
  chunkCount: number;
  chunkOffsets: ChunkOffset[];
};

/** An s3_jsonl chunk line: the row entry tagged with a stable id so edit/delete
 * can target it. Mirrors the shape the normalize/append paths write. */
export type ChunkLine = { id: string; entry: unknown };

export const mapPreviousColumnsToNewColumns = (
  records: DatasetRecordInput[],
  previousColumns: DatasetColumns,
  newColumns: DatasetColumns,
): DatasetRecordInput[] => {
  const mapping: Record<string, string | undefined> = {};
  for (const previous of previousColumns) {
    const exact = newColumns.find((column) => column.name === previous.name);
    if (exact) {
      mapping[previous.name] = exact.name;
    }
  }

  const previousUnmapped = previousColumns.filter((column) => !(column.name in mapping));
  const newUnmapped = newColumns.filter((column) => !Object.values(mapping).includes(column.name));
  previousUnmapped.forEach((previous, index) => {
    const next = newUnmapped[index];
    if (next) {
      mapping[previous.name] = next.name;
    }
  });

  return records.map((record) => {
    const mapped: DatasetRecordInput = record.id ? { id: record.id } : {};
    for (const [key, value] of Object.entries(record)) {
      if (key !== "id" && mapping[key]) {
        mapped[mapping[key]!] = value;
      }
    }

    return mapped;
  });
};

/**
 * Wrap raw row entries as `{ id, entry }` chunk lines: mint a stable per-row id
 * (`record_<nanoid>`), and scrub U+0000 from the entry (I-NULL). `forcedIds`
 * pins each new row's id. Shared by the append and born-on-storage paths.
 */
export const toChunkLines = (
  entries: unknown[],
  { forcedIds }: { forcedIds?: (string | undefined)[] } = {},
): ChunkLine[] => {
  const lines = entries.map((entry, i) => ({
    id: forcedIds?.[i] ?? `record_${nanoid()}`,
    entry: stripNullBytes(entry),
  }));
  // I-PG: row ids are unique within a dataset (the legacy PG PK). Minted ids can't
  // collide, but caller-supplied `forcedIds` can — reject the duplicate at the
  // id-assignment chokepoint rather than silently creating a ghost row.
  // Within-batch only: a cross-batch collision needs an O(rowCount) scan the edit
  // create-on-miss path already guards.
  const seen = new Set<string>();
  for (const { id } of lines) {
    if (seen.has(id)) {
      throw new DuplicateRecordIdError(id);
    }

    seen.add(id);
  }

  return lines;
};

export const isChunkLine = (line: unknown): line is ChunkLine =>
  typeof line === "object" && line !== null && "id" in line && "entry" in line;

/** Read the persisted `chunkOffsets` JSON back as a typed array (defensive
 * against a null/legacy value — defaults to empty). */
export const readOffsets = (dataset: Pick<DatasetMutationRecord, "chunkOffsets">): ChunkOffset[] =>
  Array.isArray(dataset.chunkOffsets) ? (dataset.chunkOffsets as unknown as ChunkOffset[]) : [];

/** Gate a mutation on `status='ready'` (Decision 6). Throws otherwise so a
 * still-preparing or failed dataset is never mutated under the lock. */
export const assertReady = (
  dataset: Pick<DatasetMutationRecord, "status" | "statusError">,
): void => {
  if (dataset.status !== "ready") {
    throw new DatasetNotReadyError({
      status: dataset.status,
      statusError: dataset.statusError,
    });
  }
};

/**
 * Re-derive global per-chunk row offsets from a per-chunk (rowCount, byteSize)
 * list — every chunk's `startRow` is the running sum of prior chunks' rows. Used
 * after a delete so the offset index stays authoritative (I-COUNT).
 */
export const recomputeOffsets = (
  chunks: Array<{ rowCount: number; byteSize: number }>,
): { offsets: ChunkOffset[]; rowCount: number; sizeBytes: number } => {
  const offsets: ChunkOffset[] = [];
  let startRow = 0;
  let sizeBytes = 0;
  chunks.forEach((c, index) => {
    const endRow = startRow + c.rowCount;
    offsets.push({ index, startRow, endRow, byteSize: c.byteSize });
    startRow = endRow;
    sizeBytes += c.byteSize;
  });

  return { offsets, rowCount: startRow, sizeBytes };
};
