/**
 * ADR-032 Decision 5: the async dataset-normalize job.
 *
 * A standalone GroupQueue job (registered via `registerJob`, see
 * `pipelineRegistry.ts`) that turns a raw staged upload (CSV / JSONL / JSON) in
 * object storage into the chunked-JSONL dataset layout — pure Postgres + S3, no
 * ClickHouse, no fold/reactor.
 *
 * Streaming/memory contract (I-MEM): the source is read as a backpressured
 * stream and records are flushed to chunk objects as soon as the in-memory
 * buffer reaches `CHUNK_MAX_BYTES`, so the whole file is never held in an array
 * (the single exception is the guarded small-`.json` array path — a single JSON
 * array can't be parsed incrementally without a streaming JSON parser, so it's
 * capped hard).
 *
 * Idempotency / recovery (I-RECOVER, I-IDEM): the handler no-ops unless the
 * dataset is `processing`, so a dedup hit or a manual re-drive after worker
 * death re-runs cleanly. Writes start from chunk index 0 every run (a partial
 * previous run's chunks are overwritten by key, not appended to), and PG
 * counters are only flipped to `ready` once every chunk is written — a crash
 * mid-run leaves the dataset `processing` with the staging file intact, exactly
 * as the ADR requires.
 *
 * The handler is a closure over injected deps (a `DatasetRepository` and a
 * storage accessor) — no module globals — so it stays unit-testable at the
 * boundaries.
 */

import readline from "node:readline";
import type { Readable } from "node:stream";
import Papa from "papaparse";
import type { DatasetRepository } from "./dataset.repository";
import {
  CHUNK_MAX_BYTES,
  chunkedMeta,
  type DatasetChunk,
} from "./dataset-chunking";
import type { DatasetStorage } from "./dataset-storage";
import { UPLOAD_MAX_BYTES } from "./presigned-upload";
import type { DatasetColumns } from "./types";
import {
  detectFileFormat,
  type FileFormat,
  renameReservedColumns,
} from "./upload-utils";

/**
 * A single staged `.json` array can't be parsed without buffering the whole
 * file (no streaming JSON-array parser is wired in v1), so it's hard-capped well
 * below heap. JSONL is the streaming-friendly format for large datasets.
 */
export const LARGE_JSON_MAX_BYTES = 100 * 1024 * 1024;

/** Payload for the `datasetNormalize` GroupQueue job. */
export type DatasetNormalizePayload = {
  /** Stable job id (datasetId) — used for staged-job debuggability + dedup. */
  id: string;
  /**
   * Tenant id for the group/fairness machinery. Datasets are project-scoped and
   * the event-sourcing layer's tenantId IS the projectId (see
   * `createTenantId("project_…")`), so this equals `projectId`.
   */
  tenantId: string;
  projectId: string;
  datasetId: string;
  stagingKey: string;
  filename: string;
};

/** Dedup id: one normalize in flight per dataset (group key is the same). */
export const datasetNormalizeDedupId = (p: DatasetNormalizePayload): string =>
  p.datasetId;

export type DatasetNormalizeDeps = {
  repository: DatasetRepository;
  getStorage: (projectId: string) => Promise<DatasetStorage>;
};

/**
 * Thrown when a staged `.json` array is too large to buffer; surfaced to the
 * user as the dataset's `statusError`. Convert to JSONL to stream it instead.
 */
export class LargeJsonUnsupportedError extends Error {
  constructor(
    message = "Large .json files are not supported — convert to JSONL",
  ) {
    super(message);
    this.name = "LargeJsonUnsupportedError";
  }
}

/**
 * A buffer that accumulates parsed records and flushes them to chunk objects as
 * soon as their serialized size reaches `CHUNK_MAX_BYTES`, keeping memory
 * bounded regardless of the source file size. Each flush calls `writeChunks`
 * with the running `fromIndex`, so chunk keys stay contiguous across flushes.
 */
class StreamingChunkWriter {
  private buffer: unknown[] = [];
  private bufferBytes = 0;
  private nextIndex = 0;
  private readonly chunks: DatasetChunk[] = [];

  constructor(
    private readonly deps: {
      storage: DatasetStorage;
      projectId: string;
      datasetId: string;
    },
  ) {}

  async push(record: unknown): Promise<void> {
    // Track an approximate serialized size to decide when to roll over. The
    // authoritative byteSize is recomputed inside toJsonlChunks on flush.
    this.bufferBytes += Buffer.byteLength(JSON.stringify(record), "utf8") + 1;
    this.buffer.push(record);
    if (this.bufferBytes >= CHUNK_MAX_BYTES) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const written = await this.deps.storage.writeChunks({
      projectId: this.deps.projectId,
      datasetId: this.deps.datasetId,
      records: this.buffer,
      fromIndex: this.nextIndex,
    });
    this.chunks.push(...written);
    this.nextIndex += written.length;
    this.buffer = [];
    this.bufferBytes = 0;
  }

  /** Flush the remainder and return every chunk written, in order. */
  async finalize(): Promise<DatasetChunk[]> {
    await this.flush();
    return this.chunks;
  }
}

const NULL_BYTE = "\u0000";
const NULL_BYTE_GLOBAL = /\u0000/g;

/**
 * Strip raw U+0000 from text before JSON.parse. JSON.parse rejects a literal
 * null byte inside a string as a "Bad control character"; the chunk writer
 * scrubs again per-record on write (I-NULL parity with the in-memory path).
 */
const scrubNullBytes = (text: string): string =>
  text.includes(NULL_BYTE) ? text.replace(NULL_BYTE_GLOBAL, "") : text;

/** Read a whole stream into a single string (only the guarded small-json path). */
const streamToString = async (stream: Readable): Promise<string> => {
  const parts: string[] = [];
  for await (const chunk of stream) {
    parts.push(
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
    );
  }
  return parts.join("");
};

/**
 * Stream-parse a staged source into the chunk writer and capture the column
 * headers (first record / CSV fields). Memory stays bounded for CSV/JSONL.
 */
const parseInto = async (params: {
  stream: Readable;
  format: FileFormat;
  writer: StreamingChunkWriter;
  sizeBytes: number;
}): Promise<{ headers: string[] }> => {
  const { stream, format, writer, sizeBytes } = params;
  let headers: string[] = [];

  if (format === "jsonl") {
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const rawLine of rl) {
      const line = scrubNullBytes(rawLine).trim();
      if (line.length === 0) continue;
      const record = JSON.parse(line) as Record<string, unknown>;
      if (headers.length === 0) headers = Object.keys(record);
      await writer.push(record);
    }
    return { headers };
  }

  if (format === "csv") {
    await new Promise<void>((resolve, reject) => {
      // papaparse accepts a Node Readable and emits rows via `step`, so the
      // whole CSV is never materialized in memory. Serialize the backpressured
      // chunk writes by pausing the parser while a flush is in flight.
      let chain: Promise<void> = Promise.resolve();
      // papaparse's Node build accepts a Readable as a streaming source, but
      // its types only model browser File/string inputs — cast at this one seam.
      Papa.parse<Record<string, unknown>>(stream as unknown as Papa.LocalFile, {
        header: true,
        skipEmptyLines: true,
        step: (row, parser) => {
          if (headers.length === 0 && row.meta.fields) {
            headers = row.meta.fields;
          }
          parser.pause();
          chain = chain
            .then(() => writer.push(row.data))
            .then(() => parser.resume())
            .catch((error: unknown) => {
              parser.abort();
              reject(error);
            });
        },
        complete: () => {
          chain.then(() => resolve()).catch(reject);
        },
        error: (error: unknown) => reject(error),
      });
    });
    return { headers };
  }

  // format === "json": a single array — guard the size, then buffer + parse.
  if (sizeBytes > LARGE_JSON_MAX_BYTES) {
    throw new LargeJsonUnsupportedError();
  }
  const content = scrubNullBytes(await streamToString(stream)).trim();
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed)) {
    throw new Error("JSON content must be an array of objects");
  }
  for (const record of parsed as Record<string, unknown>[]) {
    if (headers.length === 0) headers = Object.keys(record);
    await writer.push(record);
  }
  return { headers };
};

/**
 * Derive `columnTypes` from the parsed headers, mirroring
 * `createDatasetFromUpload`: rename reserved columns, default every column to
 * `"string"`.
 */
const deriveColumnTypes = (headers: string[]): DatasetColumns =>
  renameReservedColumns(headers).map((name) => ({
    name,
    type: "string" as const,
  }));

/**
 * Build the `datasetNormalize` handler over its injected boundaries.
 *
 * Returns the GroupQueue process function. On success the dataset flips to
 * `ready` with PG-authoritative counters; on any failure it flips to `failed`
 * (staging file preserved for manual retry) and rethrows so the queue records
 * the failure.
 */
export const createDatasetNormalizeHandler = (deps: DatasetNormalizeDeps) => {
  return async (payload: DatasetNormalizePayload): Promise<void> => {
    const { projectId, datasetId, stagingKey, filename } = payload;

    const dataset = await deps.repository.findOne({ id: datasetId, projectId });
    // Idempotent re-drive guard (I-IDEM): only a `processing` dataset is
    // normalizable. A re-enqueue after success (ready) or a concurrent finalize
    // race is a no-op.
    if (!dataset || dataset.status !== "processing") return;

    const storage = await deps.getStorage(projectId);

    try {
      // Defense-in-depth fast reject (I-MEM): finalize already capped this, but
      // never start streaming an over-cap object.
      const sizeBytes = await storage.headStagedObjectSize({
        projectId,
        key: stagingKey,
      });
      if (sizeBytes > UPLOAD_MAX_BYTES) {
        throw new Error("Uploaded file is too large");
      }

      const format = detectFileFormat(filename);
      const stream = await storage.streamStaged({ projectId, key: stagingKey });
      const writer = new StreamingChunkWriter({
        storage,
        projectId,
        datasetId,
      });

      const { headers } = await parseInto({
        stream,
        format,
        writer,
        sizeBytes,
      });
      const chunks = await writer.finalize();
      const meta = chunkedMeta(chunks);
      const columnTypes = deriveColumnTypes(headers);

      await deps.repository.update({
        id: datasetId,
        projectId,
        data: {
          status: "ready",
          statusError: null,
          rowCount: meta.rowCount,
          sizeBytes: BigInt(meta.sizeBytes),
          chunkCount: meta.chunkCount,
          chunkOffsets: meta.chunkOffsets,
          columnTypes,
        },
      });

      // Best-effort staging cleanup — non-fatal (the lifecycle rule reaps it
      // otherwise; a failed delete must not fail a successful normalize).
      try {
        await storage.deleteStaged({ projectId, key: stagingKey });
      } catch {
        // ignore
      }
    } catch (error: unknown) {
      // Mark failed and rethrow so the queue records the failure; the staging
      // object is intentionally NOT deleted so a manual retry can re-run.
      const statusError =
        error instanceof Error ? error.message : "Normalize failed";
      await deps.repository.update({
        id: datasetId,
        projectId,
        data: { status: "failed", statusError },
      });
      throw error;
    }
  };
};
