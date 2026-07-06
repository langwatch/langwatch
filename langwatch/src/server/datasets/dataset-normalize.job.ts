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
import { StreamingChunkWriter } from "./dataset-chunk-writer";
import type { DatasetStorage } from "./dataset-storage";
import { UPLOAD_MAX_BYTES } from "./presigned-upload";
import type { DatasetColumns, DatasetConfirmColumns } from "./types";
import {
  convertValueToColumnType,
  dedupeHeaders,
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
  /**
   * User-confirmed columns from the upload step (ADR-032 v19). When the confirm
   * UI sent the richer shape, each column carries an immutable `sourceHeader` —
   * the canonical header it was parsed from — and is bound to its file header BY
   * HEADER, so the user can drag-reorder and rename in the confirm step without
   * scrambling the data. A legacy bare name+type list (no `sourceHeader`) binds
   * positionally (`targetColumns[i]` ↔ canonical header `i`), the pre-reorder
   * behaviour. Each record's keys are renamed to the confirmed `name` and each
   * value converted to the confirmed `type` as it streams; the final
   * `appliedColumnTypes` is the confirmed list in the user's chosen order, with
   * `sourceHeader` stripped. The confirmed list may cover a SUBSET of the file
   * headers — omitted headers are columns the user excluded, and their values
   * are dropped per record (stray keys not present as file headers are still
   * preserved). A duplicate/phantom `sourceHeader`, an empty list, or a legacy
   * count mismatch honours nothing and derives all-`string` from the headers.
   */
  targetColumns?: DatasetConfirmColumns | DatasetColumns | null;
}): Promise<{
  headers: string[];
  appliedColumnTypes: DatasetColumns | null;
}> => {
  const { stream, format, writer, sizeBytes, targetColumns } = params;
  let headers: string[] = [];
  let renameMap = new Map<string, string>();
  // canonicalHeader → confirmed { name, type }; built once headers are known and
  // only when the confirmed columns bind cleanly (else stays null →
  // derive-all-string). With the confirm shape this may cover a SUBSET of the
  // file headers — the omitted ones are columns the user excluded.
  let targetByCanonical: Map<string, DatasetColumns[number]> | null = null;
  // The full set of file headers, set alongside a sourceHeader-bound map. Lets
  // `applyTarget` tell an EXCLUDED header (in the file, not confirmed → drop)
  // apart from a STRAY key (not a file header at all, e.g. a JSONL record with
  // extra keys → keep). Null on the legacy positional path (no exclusion).
  let canonicalSet: Set<string> | null = null;
  const buildTargetMap = (canonical: string[]): void => {
    // An empty confirmed list can't produce a 0-column dataset; degrade instead.
    if (!targetColumns || targetColumns.length === 0) return;
    // Confirmed names become the stored record keys (`out[target.name]` below),
    // so a blank or duplicated name would collapse two columns onto one key
    // (silent per-record data loss) or write an `""`-keyed column. The upload
    // route's schema already rejects this, so reaching here means a malformed
    // stored row — degrade to a derived all-`string` schema rather than emit the
    // corruption.
    const names = targetColumns.map((c) => c.name);
    if (
      names.some((name) => name.trim() === "") ||
      new Set(names).size !== names.length
    ) {
      return;
    }
    // Prefer binding by the immutable `sourceHeader` (survives drag-reorder +
    // rename + exclusion); fall back to positional binding for legacy bare
    // name+type lists (which require an exact 1:1 count — no exclusion).
    const hasSourceHeaders = targetColumns.every(
      (c) =>
        typeof (c as DatasetConfirmColumns[number]).sourceHeader === "string",
    );
    // A PARTIAL confirm payload (some items carry `sourceHeader`, some don't) is
    // a client bug, not a legacy list — positional-binding it could silently map
    // values to the wrong column. Mirror the upload route (which rejects any
    // "looks like confirm" payload) and degrade rather than fall through to the
    // positional branch below.
    const hasAnySourceHeaders = targetColumns.some(
      (c) =>
        typeof (c as DatasetConfirmColumns[number]).sourceHeader === "string",
    );
    if (hasAnySourceHeaders && !hasSourceHeaders) return;
    if (hasSourceHeaders) {
      const byHeader = new Map(
        (targetColumns as DatasetConfirmColumns).map((c) => [
          c.sourceHeader,
          c,
        ]),
      );
      // Duplicate `sourceHeader`s collapse in the Map (last wins), which would
      // bind fewer columns than `targetColumns` claims while `appliedColumnTypes`
      // still persists the phantom duplicate. Degrade rather than emit that.
      if (byHeader.size !== targetColumns.length) return;
      // Every confirmed column must reference a real file header (no phantom).
      // A SUBSET is allowed — headers absent from the confirmed list are the
      // columns the user excluded, and are dropped per-record below.
      const canonicalHeaders = new Set(canonical);
      if (![...byHeader.keys()].every((h) => canonicalHeaders.has(h))) return;
      targetByCanonical = byHeader;
      canonicalSet = canonicalHeaders;
      return;
    }
    if (targetColumns.length !== canonical.length) return;
    targetByCanonical = new Map(
      canonical.map((h, i) => [h, targetColumns[i]!]),
    );
  };
  // Rename confirmed keys to their new names and convert their values to the
  // confirmed types; drop excluded file headers; keep stray keys untouched.
  // Identity when nothing was confirmed (or on a mismatch) — preserving the
  // pre-v19 all-`string` pass-through. Streaming: one record at a time.
  const applyTarget = (
    record: Record<string, unknown>,
  ): Record<string, unknown> => {
    if (!targetByCanonical) return record;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      const target = targetByCanonical.get(key);
      if (target) {
        // Kept column: rename + type-convert.
        out[target.name] = convertValueToColumnType(value, target.type);
      } else if (canonicalSet?.has(key)) {
        // Excluded file header: the user dropped this column — omit its value.
        continue;
      } else {
        // Stray key (not a confirmed file header): preserve as-is.
        out[key] = value;
      }
    }
    return out;
  };
  // The persisted columnTypes are the confirmed columns in the user's chosen
  // (drag) order, with the transient `sourceHeader` stripped — null when nothing
  // bound (the handler then derives all-`string`).
  const appliedColumnTypes = (): DatasetColumns | null =>
    targetByCanonical
      ? targetColumns!.map(({ name, type }) => ({ name, type }))
      : null;
  // Capture headers the first time we see them, derive the rename map, and
  // expose headers in their safe (renamed) form so columnTypes matches the
  // rewritten row keys.
  const captureHeaders = (rawKeys: string[]): void => {
    if (headers.length > 0) return;
    renameMap = buildRenameMap(rawKeys);
    headers = renameReservedColumns(rawKeys);
    buildTargetMap(headers);
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
      await writer.push(applyTarget(applyRename(record, renameMap)));
    }
    return {
      headers,
      appliedColumnTypes: appliedColumnTypes(),
    };
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
            buildTargetMap(headers);
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
            .then(() => writer.push(applyTarget(record)))
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
    return {
      headers,
      appliedColumnTypes: appliedColumnTypes(),
    };
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
    await writer.push(applyTarget(applyRename(record, renameMap)));
  }
  return {
    headers,
    appliedColumnTypes: appliedColumnTypes(),
  };
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

      // ADR-032 v19: the upload's confirm step persists the user-chosen columns
      // on the row (names + types). Honour them — rename + type-convert per
      // record as it streams. Absent (SDK / REST / API-key callers that don't
      // pass a schema) → null, so parseInto leaves rows as-is and we derive
      // all-`string` below, exactly as before.
      const confirmedColumns = (dataset.columnTypes as DatasetColumns) ?? [];
      const { headers, appliedColumnTypes } = await parseInto({
        stream,
        format,
        writer,
        sizeBytes,
        targetColumns: confirmedColumns.length > 0 ? confirmedColumns : null,
      });
      // I-MEM: finalize returns the aggregated meta built from per-chunk
      // metadata only — the chunk `jsonl` payloads were released at each flush,
      // so the whole normalized file is never accumulated in heap.
      const meta = await writer.finalize();
      const columnTypes = appliedColumnTypes ?? deriveColumnTypes(headers);

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
      // A failed dataset owns no valid chunks. parseInto flushes chunk objects
      // to S3 as it streams, so a mid-stream failure (e.g. a JSONL parse error
      // at row N of M) leaves chunk-0..k orphaned — and chunk keys, unlike
      // staging keys, carry no lifecycle TTL to reap them, so a
      // permanently-failed dataset would leak them forever. Best-effort delete
      // every flushed chunk. Swallow any secondary error so it never masks the
      // original failure cause (the staging object is preserved below for a
      // manual retry, which re-writes chunks from index 0).
      try {
        await storage.deleteChunksFrom({ projectId, datasetId, fromIndex: 0 });
      } catch {
        // non-fatal: a failed reap is preferable to masking the real error.
      }
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
