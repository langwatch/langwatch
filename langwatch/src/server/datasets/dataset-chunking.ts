/**
 * ADR-032: pure (no-I/O) helpers for the chunked-JSONL dataset layout.
 *
 * Layout: `datasets/{projectId}/{datasetId}/chunk-NNNNN.jsonl`, ordered
 * zero-padded keys, each capped at ~`CHUNK_MAX_BYTES`. Postgres stays
 * authoritative for the counters (rowCount / sizeBytes / chunkCount /
 * chunkOffsets); S3 LIST is repair-only and never the read path.
 *
 * This module is deliberately provider-agnostic: it owns the chunk
 * boundaries, counts, offsets, key scheme, null-byte scrubbing and JSONL
 * (de)serialization, with zero coupling to S3 or the filesystem. The
 * `DatasetStorage` implementations import these helpers; they never
 * reimplement them. Keeping the math pure lets the ADR invariants (I-NULL,
 * I-COUNT) be unit-tested in isolation.
 */
import { stripNullBytes } from "./sanitize";

/**
 * ADR-032 CHUNK_MAX_BYTES — byte cap per JSONL chunk object (~16 MB, v5).
 * The only hard chunk bound in v1: small enough to bound normalize memory
 * and the future paginated read's per-chunk I/O, large enough to avoid an
 * object explosion (~128 objects per 2 GB). A row-count ceiling is deferred
 * to the reads epic (a low row cap explodes object count on light rows).
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

export type ChunkedDatasetMeta = {
  rowCount: number;
  sizeBytes: number;
  chunkCount: number;
  chunkOffsets: ChunkOffset[];
};

/**
 * Split records into JSONL chunks, each at most `maxBytes` (a single row
 * larger than the cap still gets its own chunk — never dropped). Null
 * bytes are scrubbed per row (Postgres-parity, I-NULL) before serializing.
 * Pure: no I/O, deterministic.
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
    if (lines.length === 0) return;
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

/** Aggregate per-dataset metadata from a chunk list (PG-authoritative). */
export const chunkedMeta = (chunks: DatasetChunk[]): ChunkedDatasetMeta => ({
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

/** Tenant-prefixed, ordered, zero-padded chunk key. */
export const chunkKey = (
  projectId: string,
  datasetId: string,
  index: number,
): string =>
  `datasets/${projectId}/${datasetId}/chunk-${String(index).padStart(5, "0")}.jsonl`;

/**
 * Guard against `..` / `/` in an id segment before it is interpolated into
 * an object key or filesystem path. Shared by every storage impl so the
 * traversal invariant (I-TENANT) is enforced in exactly one place.
 */
export const assertNoTraversal = (...parts: string[]): void => {
  for (const part of parts) {
    if (part.includes("..") || part.includes("/")) {
      throw new Error("Invalid id: path traversal attempt detected");
    }
  }
};

/** Parse a JSONL blob into rows, ignoring blank lines. */
export const parseJsonl = (jsonl: string): unknown[] =>
  jsonl
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
