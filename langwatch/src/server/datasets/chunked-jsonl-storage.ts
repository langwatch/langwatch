/**
 * ADR-032: dataset content lives in object storage as chunked JSONL.
 *
 * Layout: `datasets/{projectId}/{datasetId}/chunk-NNNNN.jsonl`, ordered
 * zero-padded keys, each capped at ~`CHUNK_MAX_BYTES`. Postgres stays
 * authoritative for the counters (rowCount / sizeBytes / chunkCount /
 * chunkOffsets); S3 LIST is repair-only and never the read path.
 *
 * This module is split deliberately:
 *   - `toJsonlChunks` / `chunkedMeta` are PURE (no I/O) so the chunk
 *     boundaries, counts, offsets and null-byte scrubbing are unit-tested
 *     in isolation (ADR invariants I-NULL, I-COUNT).
 *   - `writeDatasetChunks` / `readDatasetChunks` are the thin I/O adapter
 *     over `createS3Client` (or the local-FS fallback), covered
 *     end-to-end by the normalize/migration rungs.
 */
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs/promises";
import path from "path";
import { env } from "~/env.mjs";
import { createS3Client } from "../storage";
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

const assertNoTraversal = (...parts: string[]) => {
  for (const part of parts) {
    if (part.includes("..") || part.includes("/")) {
      throw new Error("Invalid id: path traversal attempt detected");
    }
  }
};

const localChunkPath = (key: string) => {
  const storageDir =
    process.env.LOCAL_STORAGE_PATH ?? path.resolve(process.cwd(), "storage");
  return path.join(storageDir, key);
};

const putChunkObject = async (
  projectId: string,
  key: string,
  jsonl: string,
): Promise<void> => {
  if (env.DATASET_STORAGE_LOCAL) {
    const filePath = localChunkPath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, jsonl, "utf-8");
    return;
  }
  const { s3Client, s3Bucket } = await createS3Client(projectId);
  await s3Client.send(
    new PutObjectCommand({
      Bucket: s3Bucket,
      Key: key,
      Body: jsonl,
      ContentType: "application/x-ndjson",
    }),
  );
};

const errorHasProp = (
  error: unknown,
  prop: "code" | "name",
  value: string,
): boolean =>
  typeof error === "object" &&
  error !== null &&
  prop in error &&
  (error as Record<string, unknown>)[prop] === value;

/**
 * A missing chunk is **corruption**, not emptiness: `readDatasetChunks` is
 * driven by PG-authoritative `chunkCount`, so chunk `i` for `i < chunkCount`
 * must exist. Returning "" on ENOENT/NoSuchKey would silently truncate the
 * dataset while the counts still claim full data — so we throw and fail fast.
 */
const getChunkObject = async (
  projectId: string,
  key: string,
): Promise<string> => {
  if (env.DATASET_STORAGE_LOCAL) {
    try {
      return await fs.readFile(localChunkPath(key), "utf-8");
    } catch (error: unknown) {
      if (errorHasProp(error, "code", "ENOENT")) {
        throw new Error(`Missing dataset chunk: ${key}`);
      }
      throw error;
    }
  }
  const { s3Client, s3Bucket } = await createS3Client(projectId);
  try {
    const { Body } = await s3Client.send(
      new GetObjectCommand({ Bucket: s3Bucket, Key: key }),
    );
    return (await Body?.transformToString()) ?? "";
  } catch (error: unknown) {
    if (errorHasProp(error, "name", "NoSuchKey")) {
      throw new Error(`Missing dataset chunk: ${key}`);
    }
    throw error;
  }
};

const parseJsonl = (jsonl: string): unknown[] =>
  jsonl
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));

/**
 * Write a record set as chunked JSONL starting at `fromIndex` (0 for a
 * fresh dataset, `chunkCount` to append) and return the metadata for the
 * chunks just written. Append is "write a new chunk object" — existing
 * chunks are never rewritten.
 */
export const writeDatasetChunks = async ({
  projectId,
  datasetId,
  records,
  fromIndex = 0,
  maxBytes = CHUNK_MAX_BYTES,
}: {
  projectId: string;
  datasetId: string;
  records: unknown[];
  fromIndex?: number;
  maxBytes?: number;
}): Promise<DatasetChunk[]> => {
  assertNoTraversal(projectId, datasetId);
  const chunks = toJsonlChunks(records, { maxBytes }).map((c) => ({
    ...c,
    index: c.index + fromIndex,
  }));
  for (const chunk of chunks) {
    await putChunkObject(
      projectId,
      chunkKey(projectId, datasetId, chunk.index),
      chunk.jsonl,
    );
  }
  return chunks;
};

/**
 * Read all rows of a dataset back from its chunk objects, in order.
 * Driven by PG-authoritative `chunkCount` (not S3 LIST).
 */
export const readDatasetChunks = async ({
  projectId,
  datasetId,
  chunkCount,
}: {
  projectId: string;
  datasetId: string;
  chunkCount: number;
}): Promise<unknown[]> => {
  assertNoTraversal(projectId, datasetId);
  const rows: unknown[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const jsonl = await getChunkObject(
      projectId,
      chunkKey(projectId, datasetId, i),
    );
    if (jsonl) rows.push(...parseJsonl(jsonl));
  }
  return rows;
};
