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
import { nanoid } from "nanoid";
import Papa from "papaparse";
import type { DatasetRepository } from "./dataset.repository";
import {
  CHUNK_MAX_BYTES,
  type ChunkedDatasetMeta,
  type ChunkMeta,
  chunkedMeta,
  chunkMetaOf,
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

/**
 * Max bytes for a single JSONL line (I-MEM). `readline` emits one line at a
 * time, so a normal file never buffers more than a line; but a pathological
 * file with no newlines (or one giant line) would make `readline` buffer the
 * whole thing in memory. Assumption: a legitimate dataset row fits well under
 * this — over it, the file is treated as malformed and the dataset is failed
 * rather than risking an OOM.
 */
export const MAX_JSONL_LINE_BYTES = 8 * 1024 * 1024;

/**
 * Max bytes for a single CSV row (I-MEM), the CSV counterpart to
 * `MAX_JSONL_LINE_BYTES`. papaparse buffers until it can emit a complete row, so
 * a malformed CSV with no row delimiter (or one giant field) would make it
 * accumulate the whole file in memory before the first `step`. We track the
 * parser cursor delta between rows and `abort()` once a single row crosses this
 * cap, failing the dataset rather than risking an OOM.
 */
export const MAX_CSV_ROW_BYTES = 8 * 1024 * 1024;

/**
 * papaparse read-buffer size — how many bytes it pulls from the source stream
 * before emitting rows, so it reads in fixed-size I/O chunks rather than draining
 * the stream as fast as the chunk writer allows (backpressure). Distinct concern
 * from `MAX_CSV_ROW_BYTES` (the per-row payload cap) even though both currently
 * sit at 8 MB — tune one without implying the other.
 */
export const CSV_IO_CHUNK_BYTES = 8 * 1024 * 1024;

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
 *
 * Each JSONL line is wrapped as `{ id, entry }` (mirroring the logical
 * `DatasetRecord` shape) so every row carries a stable id a later edit/delete
 * rung can target — the read adapter maps `{id, entry}` back to a
 * `DatasetRecord`-shaped object. The id is assigned per-record here in the
 * streaming writer so this stays streaming (never builds an in-memory array of
 * the whole file).
 */
class StreamingChunkWriter {
  private buffer: unknown[] = [];
  private bufferBytes = 0;
  private nextIndex = 0;
  /**
   * I-MEM: accumulate only lightweight per-chunk metadata (no `jsonl` payload).
   * Each flush maps its written `DatasetChunk[]` to `ChunkMeta[]` and drops the
   * serialized bodies, so a multi-GB upload never holds the whole normalized
   * file in heap by the time `finalize()` runs.
   */
  private readonly chunkMetas: ChunkMeta[] = [];

  constructor(
    private readonly deps: {
      storage: DatasetStorage;
      projectId: string;
      datasetId: string;
    },
  ) {}

  async push(entry: unknown): Promise<void> {
    // Wrap the raw row as { id, entry } — the stable per-row id later
    // edit/delete targets. nanoid() per record keeps this streaming.
    const record = { id: `record_${nanoid()}`, entry };
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
    // I-MEM: keep only the metadata; the `jsonl` payloads are released here so
    // they can be garbage-collected immediately after the write returns.
    this.chunkMetas.push(...written.map(chunkMetaOf));
    this.nextIndex += written.length;
    this.buffer = [];
    this.bufferBytes = 0;
  }

  /**
   * Flush the remainder and return the aggregated `ChunkedDatasetMeta`, computed
   * from the accumulated per-chunk metadata alone (never the `jsonl` payloads).
   */
  async finalize(): Promise<ChunkedDatasetMeta> {
    await this.flush();
    return chunkedMeta(this.chunkMetas);
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

/**
 * Approximate the serialized byte size of one parsed CSV row from its field
 * values (I-MEM guard). papaparse buffers until it can emit a complete row, so a
 * malformed row (no delimiter / one giant field) shows up here as an oversized
 * `row.data` — summing the field byte-lengths bounds it without re-reading the
 * raw input. Cheap: one `Buffer.byteLength` per field on the rare large row.
 */
const csvRowBytes = (data: Record<string, unknown>): number => {
  let bytes = 0;
  for (const value of Object.values(data)) {
    if (typeof value === "string") {
      bytes += Buffer.byteLength(value, "utf8");
    } else if (value != null) {
      bytes += Buffer.byteLength(String(value), "utf8");
    }
  }
  return bytes;
};

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
 * Build the original→safe column rename map (m4). Reserved column names (`id`,
 * etc.) are renamed to a safe form (`id_`) exactly as `createDatasetFromUpload`
 * does; only entries that actually changed are kept so the common case is a
 * no-op pass-through.
 */
const buildRenameMap = (headers: string[]): Map<string, string> => {
  const renamed = renameReservedColumns(headers);
  const map = new Map<string, string>();
  headers.forEach((original, i) => {
    if (original !== renamed[i]) map.set(original, renamed[i]!);
  });
  return map;
};

/**
 * Make column names unique by suffixing repeats `_1`, `_2`, … — the same scheme
 * papaparse's `header:true` dedup uses, but applied ONCE to the header row.
 *
 * The CSV path parses with `header:false` and maps rows to objects by index
 * (below) precisely to AVOID papaparse's header machinery: under our
 * pause/resume backpressure it re-runs its duplicate-name dedup against the
 * CURRENT data row on every resume, so any row holding two equal cells (an input
 * that equals its expected output, or two empty cells) had its second value
 * silently corrupted with a `_1` suffix — and logged a warning per row. Deduping
 * the header ourselves keeps the legitimate "two columns named the same" rename
 * without ever touching row values.
 */
const dedupeHeaders = (headers: string[]): string[] => {
  const seen = new Map<string, number>();
  // Track the names actually emitted, not just the raw inputs: a suffixed
  // candidate (`col_1`) can still collide with a column literally named `col_1`,
  // so keep bumping the counter until the candidate is unique. Without this,
  // `["col","col","col_1"]` would emit `["col","col_1","col_1"]` and the by-index
  // record map below would silently overwrite one column's values with another's.
  const emitted = new Set<string>();
  return headers.map((header) => {
    let count = seen.get(header) ?? 0;
    let candidate = count === 0 ? header : `${header}_${count}`;
    while (emitted.has(candidate)) {
      candidate = `${header}_${++count}`;
    }
    seen.set(header, count + 1);
    emitted.add(candidate);
    return candidate;
  });
};

/**
 * Rewrite a record's keys through the rename map so the stored JSONL row keys
 * match `columnTypes` (m4). Streaming — one record at a time, never buffers the
 * file. A no-op when nothing was renamed.
 */
const applyRename = (
  record: Record<string, unknown>,
  renameMap: Map<string, string>,
): Record<string, unknown> => {
  if (renameMap.size === 0) return record;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[renameMap.get(key) ?? key] = value;
  }
  return out;
};

/**
 * Stream-parse a staged source into the chunk writer and capture the (already
 * reserved-renamed) column headers from the first record / CSV fields. Each
 * record's keys are rewritten through the rename map as it streams through so
 * stored rows match `columnTypes` (m4). Memory stays bounded for CSV/JSONL.
 */
const parseInto = async (params: {
  stream: Readable;
  format: FileFormat;
  writer: StreamingChunkWriter;
  sizeBytes: number;
}): Promise<{ headers: string[] }> => {
  const { stream, format, writer, sizeBytes } = params;
  let headers: string[] = [];
  let renameMap = new Map<string, string>();
  // Capture headers the first time we see them, derive the rename map, and
  // expose headers in their safe (renamed) form so columnTypes matches the
  // rewritten row keys.
  const captureHeaders = (rawKeys: string[]): void => {
    if (headers.length > 0) return;
    renameMap = buildRenameMap(rawKeys);
    headers = renameReservedColumns(rawKeys);
  };

  if (format === "jsonl") {
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const rawLine of rl) {
      // I-MEM: bound a pathological no-newline / giant-line file. `readline`
      // already buffers a line at a time; this caps that buffer's size.
      if (Buffer.byteLength(rawLine, "utf8") > MAX_JSONL_LINE_BYTES) {
        throw new Error("JSONL line exceeds max size — malformed file");
      }
      const line = scrubNullBytes(rawLine).trim();
      if (line.length === 0) continue;
      const record = JSON.parse(line) as Record<string, unknown>;
      captureHeaders(Object.keys(record));
      await writer.push(applyRename(record, renameMap));
    }
    return { headers };
  }

  if (format === "csv") {
    // CSV is parsed with `header:false` (rows as arrays) and mapped to objects
    // by index here — NOT papaparse's `header:true`. Under our pause/resume
    // backpressure, papaparse re-runs its duplicate-header dedup against the
    // current data row on every resume, suffixing the second of any two equal
    // cells with `_1` (corrupting e.g. input==expected rows, or two blank cells)
    // and warning once per row. We dedup the real header row ONCE instead.
    let csvHeaders: string[] | null = null;
    await new Promise<void>((resolve, reject) => {
      // papaparse accepts a Node Readable and emits rows via `step`, so the
      // whole CSV is never materialized in memory. Serialize the backpressured
      // chunk writes by pausing the parser while a flush is in flight.
      let chain: Promise<void> = Promise.resolve();
      // papaparse's Node build accepts a Readable as a streaming source, but
      // its types only model browser File/string inputs — cast at this one seam.
      Papa.parse<string[]>(stream as unknown as Papa.LocalFile, {
        header: false,
        skipEmptyLines: true,
        // Bound papaparse's read buffer so it pulls the stream in fixed-size
        // chunks rather than draining it as fast as the chunk writer allows.
        chunkSize: CSV_IO_CHUNK_BYTES,
        step: (row, parser) => {
          const values = row.data;
          // The first row is the header: dedupe repeats + reserved-rename once.
          if (csvHeaders === null) {
            const raw = values.map((value) =>
              value == null ? "" : String(value),
            );
            csvHeaders = renameReservedColumns(dedupeHeaders(raw));
            headers = csvHeaders;
            return;
          }
          const record: Record<string, unknown> = {};
          csvHeaders.forEach((header, i) => {
            record[header] = values[i];
          });
          // I-MEM: reject a single row whose serialized fields cross
          // MAX_CSV_ROW_BYTES (a malformed CSV with no row delimiter or one
          // giant field), the CSV counterpart to the JSONL line cap — fail the
          // dataset rather than risk an OOM accumulating an unbounded row.
          if (csvRowBytes(record) > MAX_CSV_ROW_BYTES) {
            parser.abort();
            reject(new Error("CSV row exceeds max size — malformed file"));
            return;
          }
          parser.pause();
          chain = chain
            .then(() => writer.push(record))
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
    captureHeaders(Object.keys(record));
    await writer.push(applyRename(record, renameMap));
  }
  return { headers };
};

/**
 * Derive `columnTypes` from the (already reserved-renamed) headers, mirroring
 * `createDatasetFromUpload`: default every column to `"string"`.
 */
const deriveColumnTypes = (headers: string[]): DatasetColumns =>
  headers.map((name) => ({
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
      // I-MEM: finalize returns the aggregated meta built from per-chunk
      // metadata only — the chunk `jsonl` payloads were released at each flush,
      // so the whole normalized file is never accumulated in heap.
      const meta = await writer.finalize();
      const columnTypes = deriveColumnTypes(headers);

      // m5: an empty upload is a failure, not a 0-chunk `ready` dataset — this
      // matches the legacy upload contract (which rejects an empty file).
      if (meta.rowCount === 0) {
        throw new Error("Uploaded file is empty");
      }

      // I-IDEM: a re-drive that wrote fewer chunks than a crashed prior run
      // leaves orphan `chunk-NNNNN` objects past this run's last index. Delete
      // them before flipping to `ready` so the chunk set matches `chunkCount`.
      await storage.deleteChunksFrom({
        projectId,
        datasetId,
        fromIndex: meta.chunkCount,
      });

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
