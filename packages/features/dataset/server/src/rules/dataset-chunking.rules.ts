/**
 * ADR-032: pure (no-I/O) helpers for the chunked-JSONL dataset layout.
 */
import { stripNullBytes } from "./dataset-sanitize.rules";

export { assertKeyWithinProject, assertNoTraversal, chunkKey } from "@langwatch/dataset-contract";

/**
 * ADR-032 CHUNK_MAX_BYTES — byte cap per JSONL chunk object (~16 MB, v5).
 */
export const CHUNK_MAX_BYTES = 16 * 1024 * 1024;

export type DatasetChunk = {
  index: number;
  jsonl: string;
  rowCount: number;
  byteSize: number;
  /** inclusive global row offset of the first row in this chunk */
  startRow: number;
  /** exclusive global row offset of the row after the last in this chunk */
  endRow: number;
};

export type ChunkOffset = {
  index: number;
  startRow: number;
  endRow: number;
  byteSize: number;
};

/**
 * Lightweight per-chunk metadata — everything `chunkedMeta` needs to build the PG-authoritative
 * addressing WITHOUT the chunk's `jsonl` payload (I-MEM).
 */
export type ChunkMeta = {
  index: number;
  rowCount: number;
  byteSize: number;
  startRow: number;
  endRow: number;
};

/** Project a heavy `DatasetChunk` down to its `ChunkMeta` (drops `jsonl`). */
export const chunkMetaOf = (chunk: DatasetChunk): ChunkMeta => ({
  index: chunk.index,
  rowCount: chunk.rowCount,
  byteSize: chunk.byteSize,
  startRow: chunk.startRow,
  endRow: chunk.endRow,
});

export type ChunkedDatasetMeta = {
  rowCount: number;
  sizeBytes: number;
  chunkCount: number;
  chunkOffsets: ChunkOffset[];
};

/**
 * Split records into JSONL chunks, each at most `maxBytes` (a single row larger than the cap
 * still gets its own chunk — never dropped). Null bytes are scrubbed per row (Postgres-parity,
 * I-NULL) before serializing. Pure: no I/O, deterministic.
 */
export const toJsonlChunks = (
  records: unknown[],
  { maxBytes = CHUNK_MAX_BYTES }: { maxBytes?: number } = {},
): DatasetChunk[] => {
  const chunks: DatasetChunk[] = [];
  let lines: string[] = [];
  let bufBytes = 0;
  let startRow = 0;
  let rowsInChunk = 0;

  const flush = (endRow: number) => {
    if (lines.length === 0) {
      return;
    }

    const jsonl = lines.join("\n") + "\n";
    chunks.push({
      index: chunks.length,
      jsonl,
      rowCount: rowsInChunk,
      byteSize: Buffer.byteLength(jsonl, "utf8"),
      startRow,
      endRow,
    });
    lines = [];
    bufBytes = 0;
    startRow = endRow;
    rowsInChunk = 0;
  };

  records.forEach((record, i) => {
    const line = JSON.stringify(stripNullBytes(record));
    const lineBytes = Buffer.byteLength(line, "utf8") + 1; // + "\n"
    // Roll over before appending, but only when the current chunk already
    // holds something — so an oversized single row still lands in its own
    // chunk instead of being silently dropped.
    if (bufBytes > 0 && bufBytes + lineBytes > maxBytes) {
      flush(i);
    }

    lines.push(line);
    bufBytes += lineBytes;
    rowsInChunk += 1;
  });
  flush(records.length);

  return chunks;
};

/**
 * Serialize exactly these records into ONE JSONL blob (no byte-cap roll-over), scrubbing null
 * bytes per row (I-NULL) like `toJsonlChunks`.
 */
export const toSingleJsonl = (records: unknown[]): { jsonl: string; byteSize: number } => {
  const jsonl =
    records.map((record) => JSON.stringify(stripNullBytes(record))).join("\n") +
    (records.length > 0 ? "\n" : "");

  return { jsonl, byteSize: Buffer.byteLength(jsonl, "utf8") };
};

/**
 * Aggregate per-dataset metadata from a chunk list (PG-authoritative). Accepts the lightweight
 * `ChunkMeta` (a `DatasetChunk` is structurally assignable), so the streaming writer can build
 * the final meta from metadata alone — never holding the `jsonl` payloads (I-MEM).
 */
export const chunkedMeta = (chunks: ChunkMeta[]): ChunkedDatasetMeta => ({
  rowCount: chunks.reduce((n, c) => n + c.rowCount, 0),
  sizeBytes: chunks.reduce((n, c) => n + c.byteSize, 0),
  chunkCount: chunks.length,
  chunkOffsets: chunks.map((c) => ({
    index: c.index,
    startRow: c.startRow,
    endRow: c.endRow,
    byteSize: c.byteSize,
  })),
});

/** Parse a JSONL blob into rows, ignoring blank lines. */
export const parseJsonl = (jsonl: string): unknown[] =>
  jsonl
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));

/**
 * Narrow an `unknown` caught value to one carrying a given property with a given string value.
 * Shared by every storage impl so the "is this a NoSuchKey / ENOENT?" check lives in exactly
 * one place.
 */
export const errorHasProp = (error: unknown, prop: "code" | "name", value: string): boolean =>
  typeof error === "object" &&
  error !== null &&
  prop in error &&
  (error as Record<string, unknown>)[prop] === value;

/**
 * True when a caught error is a "missing object" from any storage backend — the 4-way
 * `name`/`code` × `NoSuchKey`/`NotFound` check.
 */
export const isMissingObjectError = (error: unknown): boolean =>
  errorHasProp(error, "name", "NoSuchKey") ||
  errorHasProp(error, "name", "NotFound") ||
  errorHasProp(error, "code", "NoSuchKey") ||
  errorHasProp(error, "code", "NotFound");
