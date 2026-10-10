/**
 * ADR-032 Decision 5: the async dataset-normalize job.
 */

import {
  convertValueToColumnType,
  detectFileFormat,
  renameReservedColumns,
  type DatasetColumns,
  type DatasetConfirmColumns,
  type FileFormat,
  type DatasetNormalizePayload,
  UploadNotPendingError,
  UploadValidationError,
} from "@langwatch/dataset-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";

import type {
  DatasetNormalize,
  DatasetNormalizeOutcome,
  DatasetNormalizeQueue,
} from "../app/dataset.app.ts";
import type { DatasetChunkRepository } from "../repositories/dataset-chunk.repository.ts";
import type { DatasetContentRepository as DatasetRepository } from "../repositories/dataset-content.repository.ts";
import { onceMaxBytes } from "../rules/dataset-inline-file.rules.ts";
import { assertStoredRowWithinLimit } from "../rules/dataset-row-limits.rules.ts";
import { StreamingChunkWriterService } from "./dataset-chunk-writer.service.ts";
import {
  DatasetFileReaderService,
  type DatasetFileReadLimits,
} from "./dataset-file-reader.service.ts";
import {
  type DatasetInlineAttachmentService,
  type InlineAttachmentScope,
} from "./dataset-inline-attachment.service.ts";
import type { DatasetRequestBoundsService } from "./dataset-request-bounds.service.ts";

export type DatasetNormalizeDeps = {
  repository: DatasetRepository;
  chunks: DatasetChunkRepository;
  /** The confirmed import file is read from here as a stream (ADR-158 §2). */
  storedObjects: Pick<StoredObjectApi, "getById">;
  /** The row and `.json` limits the project's organization answers. */
  requestBounds: Pick<DatasetRequestBoundsService, "limits">;
  /** Stores the files a row carries inline and leaves their references. */
  inlineAttachments: Pick<DatasetInlineAttachmentService, "store">;
};

async function deleteFlushedChunks({
  storage,
  projectId,
  datasetId,
}: {
  storage: DatasetChunkRepository;
  projectId: string;
  datasetId: string;
}): Promise<void> {
  try {
    await storage.deleteChunksFrom({ projectId, datasetId, fromIndex: 0 });
  } catch (cleanupError) {
    if (!(cleanupError instanceof Error)) {
      throw cleanupError;
    }
    // non-fatal: a failed reap is preferable to masking the real error.
  }
}

/**
 * The payload names a different file than the dataset row: the payload is stale
 * or forged, and the row is left untouched for its own job.
 */
export class ImportSourceMismatchError extends Error {
  constructor(datasetId: string, payloadSource: string, rowSource: string | null) {
    super(
      `Dataset ${datasetId} import source mismatch: payload names "${payloadSource}" ` +
        `but the row carries "${rowSource ?? "none"}"; refusing to read storage`,
    );
    this.name = "ImportSourceMismatchError";
  }
}

/**
 * Build the original→safe column rename map (m4). Reserved column names (`id`, etc.) are
 * renamed to a safe form (`id_`) exactly as `createDatasetFromUpload` does; only entries that
 * actually changed are kept so the common case is a no-op pass-through.
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

type TargetBinding =
  | {
      kind: "bound";
      byCanonical: Map<string, DatasetColumns[number]>;
      /** The file headers when bound by `sourceHeader`; null on the positional path. */
      canonicalSet: Set<string> | null;
    }
  | { kind: "unbound" };

/** Binds the confirmed columns to the file's canonical headers, or degrades to unbound. */
const bindTargetColumns = ({
  targetColumns,
  canonical,
}: {
  targetColumns: DatasetConfirmColumns | DatasetColumns | null | undefined;
  canonical: string[];
}): TargetBinding => {
  // An empty confirmed list can't produce a 0-column dataset; degrade instead.
  if (!targetColumns || targetColumns.length === 0) return { kind: "unbound" };
  // Confirmed names become the stored record keys (`out[target.name]` below), so a blank or
  // duplicated name would collapse two columns onto one key (silent per-record data loss) or
  // write an `""`-keyed column. The upload route's schema already rejects this, so reaching
  // here means a malformed stored row — degrade to a derived all-`string` schema rather than
  // emit the corruption.
  const names = targetColumns.map((c) => c.name);
  if (names.some((name) => name.trim() === "") || new Set(names).size !== names.length) {
    return { kind: "unbound" };
  }
  // Prefer binding by the immutable `sourceHeader` (survives drag-reorder +
  // rename + exclusion); fall back to positional binding for legacy bare
  // name+type lists (which require an exact 1:1 count — no exclusion).
  const hasSourceHeaders = targetColumns.every(
    (c) => typeof (c as DatasetConfirmColumns[number]).sourceHeader === "string",
  );
  // A PARTIAL confirm payload (some items carry `sourceHeader`, some don't) is
  // a client bug, not a legacy list — positional-binding it could silently map
  // values to the wrong column. Mirror the upload route (which rejects any
  // "looks like confirm" payload) and degrade rather than fall through to the
  // positional branch below.
  const hasAnySourceHeaders = targetColumns.some(
    (c) => typeof (c as DatasetConfirmColumns[number]).sourceHeader === "string",
  );
  if (hasAnySourceHeaders && !hasSourceHeaders) return { kind: "unbound" };
  if (hasSourceHeaders) {
    const byHeader = new Map(
      (targetColumns as DatasetConfirmColumns).map((c) => [c.sourceHeader, c]),
    );
    // Duplicate `sourceHeader`s collapse in the Map (last wins), which would
    // bind fewer columns than `targetColumns` claims while `appliedColumnTypes`
    // still persists the phantom duplicate. Degrade rather than emit that.
    if (byHeader.size !== targetColumns.length) return { kind: "unbound" };
    // Every confirmed column must reference a real file header (no phantom).
    // A SUBSET is allowed — headers absent from the confirmed list are the
    // columns the user excluded, and are dropped per-record below.
    const canonicalHeaders = new Set(canonical);
    const confirmedHeaders = [...byHeader.keys()];
    const everyHeaderIsReal = confirmedHeaders.every((h) => canonicalHeaders.has(h));
    if (!everyHeaderIsReal) return { kind: "unbound" };
    return { kind: "bound", byCanonical: byHeader, canonicalSet: canonicalHeaders };
  }
  if (targetColumns.length !== canonical.length) return { kind: "unbound" };
  return {
    kind: "bound",
    byCanonical: new Map(canonical.map((h, i) => [h, targetColumns[i]!])),
    canonicalSet: null,
  };
};

// Rename confirmed keys to their new names and convert their values to the
// confirmed types; drop excluded file headers; keep stray keys untouched.
// Identity when nothing was confirmed (or on a mismatch) — preserving the
// pre-v19 all-`string` pass-through. Streaming: one record at a time.
const applyTargetBinding = (
  record: Record<string, unknown>,
  binding: TargetBinding,
): Record<string, unknown> => {
  if (binding.kind !== "bound") return record;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const target = binding.byCanonical.get(key);
    if (target) {
      // Kept column: rename + type-convert.
      out[target.name] = convertValueToColumnType(value, target.type);
      continue;
    }
    // An excluded file header is dropped; a stray key (not a file header) is kept as-is.
    if (binding.canonicalSet?.has(key)) continue;
    out[key] = value;
  }
  return out;
};

/**
 * Stream-parse a source into the chunk writer and capture the reserved-renamed column headers
 * from the first record or the CSV header row. Each record's keys go through the rename map so
 * stored rows match `columnTypes` (m4), and a row's inline files are stored before it is written.
 */
const parseInto = async (params: {
  bytes: AsyncIterable<Uint8Array>;
  format: FileFormat;
  writer: StreamingChunkWriterService;
  limits: DatasetFileReadLimits;
  /** Known up front for a stored object; a staged file is bounded while it streams. */
  sizeBytes?: number;
  /**
   * User-confirmed columns from the upload step (ADR-032 v19).
   */
  targetColumns?: DatasetConfirmColumns | DatasetColumns | null;
  /** Stores one row's inline files, given the columns the row is bound to. */
  storeInlineFiles: (
    record: Record<string, unknown>,
    columns: DatasetColumns | null,
  ) => Promise<Record<string, unknown>>;
}): Promise<{
  headers: string[];
  appliedColumnTypes: DatasetColumns | null;
}> => {
  const { bytes, format, writer, limits, sizeBytes, targetColumns } = params;
  let headers: string[] = [];
  let renameMap = new Map<string, string>();
  // Confirmed columns bound to the file headers once known; unbound (derive-all-string)
  // until then, or when the confirmed columns do not bind cleanly.
  let binding: TargetBinding = { kind: "unbound" };
  // The persisted columnTypes are the confirmed columns in the user's chosen
  // (drag) order, with the transient `sourceHeader` stripped; null when nothing
  // bound (the handler then derives the types).
  const appliedColumnTypes = (): DatasetColumns | null =>
    binding.kind === "bound" ? targetColumns!.map(({ name, type }) => ({ name, type })) : null;
  // Capture headers the first time we see them, derive the rename map, and
  // expose headers in their safe (renamed) form so columnTypes matches the
  // rewritten row keys.
  const captureHeaders = (rawKeys: string[]): void => {
    if (headers.length > 0) return;
    renameMap = buildRenameMap(rawKeys);
    headers = renameReservedColumns(rawKeys);
    const next = bindTargetColumns({ targetColumns, canonical: headers });
    if (next.kind === "bound") binding = next;
  };

  const reader = DatasetFileReaderService.create(limits);
  for await (const row of reader.rows({ bytes, format, sizeBytes })) {
    if (row.headers) {
      captureHeaders(row.headers);
      continue;
    }
    captureHeaders(Object.keys(row.record));
    const bound = applyTargetBinding(applyRename(row.record, renameMap), binding);
    const stored = await params.storeInlineFiles(bound, appliedColumnTypes());
    assertStoredRowWithinLimit(stored);
    await writer.push(stored);
  }

  return { headers, appliedColumnTypes: appliedColumnTypes() };
};

/**
 * Derive `columnTypes` from the (already reserved-renamed) headers, mirroring
 * `createDatasetFromUpload`: a column that held an inline picture is `"image"`,
 * every other one `"string"`.
 */
const deriveColumnTypes = (
  headers: string[],
  pictureColumns: ReadonlySet<string>,
): DatasetColumns =>
  headers.map((name) => ({
    name,
    type: pictureColumns.has(name) ? ("image" as const) : ("string" as const),
  }));

/**
 * The `datasetNormalize` work, over its injected boundaries. On success the dataset flips to
 * `ready` with PG-authoritative counters; on any failure it flips to `failed` (staging file
 * preserved for manual retry) and rethrows so the queue records the failure.
 */
export class DatasetNormalizeService implements DatasetNormalize, DatasetNormalizeQueue {
  static create(deps: DatasetNormalizeDeps): DatasetNormalizeService {
    return new DatasetNormalizeService(deps);
  }

  private readonly inlineChains = new Map<string, Promise<void>>();
  private send: ((payload: DatasetNormalizePayload) => Promise<void>) | undefined;

  private constructor(private readonly deps: DatasetNormalizeDeps) {}

  /** The `datasetNormalize` command's sender, closed over once the pipeline is registered. */
  connect(send: (payload: DatasetNormalizePayload) => Promise<void>): void {
    this.send = send;
  }

  async enqueueNormalize(input: { datasetId: string; projectId: string }): Promise<void> {
    const dataset = await this.deps.repository.getOne({
      id: input.datasetId,
      projectId: input.projectId,
    });
    if (!dataset.uploadFilename) {
      throw new UploadNotPendingError("Dataset normalization requires an imported file");
    }
    const target = {
      id: dataset.id,
      tenantId: input.projectId,
      projectId: input.projectId,
      datasetId: dataset.id,
      filename: dataset.uploadFilename,
    };
    // A row the previous release staged keeps its staging key until it is prepared (ADR-155).
    let payload: DatasetNormalizePayload;
    if (dataset.sourceStoredObjectId) {
      payload = { ...target, sourceStoredObjectId: dataset.sourceStoredObjectId };
    } else if (dataset.stagingKey) {
      payload = { ...target, stagingKey: dataset.stagingKey };
    } else {
      throw new UploadNotPendingError("Dataset normalization requires an imported file");
    }

    await (this.send ? this.send(payload) : this.runInline(payload));
  }

  /** Main's no-queue fallback: one process, so a per-dataset chain serializes inline runs. */
  private runInline(payload: DatasetNormalizePayload): Promise<void> {
    const key = `${payload.projectId}:${payload.datasetId}`;
    const prior = this.inlineChains.get(key) ?? Promise.resolve();
    const next = prior
      .catch(() => undefined)
      .then(async () => {
        await this.normalize(payload);
      });
    this.inlineChains.set(key, next);
    void next.finally(() => {
      if (this.inlineChains.get(key) === next) {
        this.inlineChains.delete(key);
      }
    });

    return next;
  }

  async normalize(payload: DatasetNormalizePayload): Promise<DatasetNormalizeOutcome> {
    const { projectId, datasetId } = payload;
    const staged = "stagingKey" in payload;

    const dataset = await this.deps.repository.findOne({ id: datasetId, projectId });
    // Idempotent re-drive guard (I-IDEM): only a `processing` dataset is
    // normalizable. A re-enqueue after success (ready) or a concurrent finalize
    // race is a no-op, answering where the row already rests: a retry after a failure settles it.
    if (dataset?.status === "ready" || dataset?.status === "failed") return dataset.status;
    if (dataset?.status !== "processing") return "skipped";
    const payloadSource = staged ? payload.stagingKey : payload.sourceStoredObjectId;
    const rowSource = staged ? dataset.stagingKey : dataset.sourceStoredObjectId;
    if (rowSource !== payloadSource) {
      throw new ImportSourceMismatchError(datasetId, payloadSource, rowSource);
    }

    const storage = this.deps.chunks;

    try {
      const { meta, columnTypes } = await this.writeChunks({
        payload,
        columnTypes: dataset.columnTypes,
      });

      await this.deps.repository.update({
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
      if (staged) await this.removeStaged({ projectId, stagingKey: payload.stagingKey });
      return "ready";
    } catch (error: unknown) {
      // A failed dataset owns no valid chunks. parseInto flushes chunk objects to S3 as it
      // streams, so a mid-stream failure (e.g. a JSONL parse error at row N of M) leaves
      // chunk-0..k orphaned — and chunk keys, unlike staging keys, carry no lifecycle TTL to
      // reap them, so a permanently-failed dataset would leak them forever. Best-effort delete
      // every flushed chunk.
      await deleteFlushedChunks({ storage, projectId, datasetId });
      // Mark failed and rethrow so the queue records the failure; the source file
      // stays, so a retry reads it again.
      const statusError = error instanceof Error ? error.message : "Normalize failed";
      await this.deps.repository.update({
        id: datasetId,
        projectId,
        data: { status: "failed", statusError },
      });
      throw error;
    }
  }

  /** Streams the source into chunk objects and returns what the dataset row records of them. */
  private async writeChunks({
    payload,
    columnTypes: confirmed,
  }: {
    payload: DatasetNormalizePayload;
    columnTypes: unknown;
  }) {
    const { projectId, datasetId, filename } = payload;
    const storage = this.deps.chunks;
    const { bytes, sizeBytes } = await this.openSource(payload);
    const format = detectFileFormat(filename);
    const limits = await this.deps.requestBounds.limits(projectId);
    const writer = StreamingChunkWriterService.create({
      storage,
      projectId,
      datasetId,
    });
    const pictureColumns = new Set<string>();
    const maxBytes = onceMaxBytes(() => Promise.resolve(limits.attachmentBytes));
    const scopeFor = (columns: DatasetColumns | null): InlineAttachmentScope => ({
      projectId,
      datasetId,
      maxBytes,
      columns: columns
        ? { kind: "typed", columnTypes: columns }
        : { kind: "untyped", onPictureColumn: (column) => pictureColumns.add(column) },
    });

    // ADR-032 v19: the upload's confirm step persists the user-chosen columns
    // on the row (names + types). Honour them: rename + type-convert per
    // record as it streams. Absent (SDK / REST / API-key callers that don't
    // pass a schema) → null, so parseInto leaves rows as-is and the types are
    // derived below.
    const confirmedColumns = (confirmed as DatasetColumns) ?? [];
    const { headers, appliedColumnTypes } = await parseInto({
      bytes,
      format,
      writer,
      limits: {
        rowBytes: limits.rowBytes,
        jsonFileBytes: limits.jsonFileBytes,
        fileBytes: limits.fileBytes,
        rowsMax: limits.rowsMax,
      },
      sizeBytes,
      targetColumns: confirmedColumns.length > 0 ? confirmedColumns : null,
      storeInlineFiles: (record, columns) =>
        this.deps.inlineAttachments.store(scopeFor(columns), record),
    });
    // I-MEM: finalize returns the aggregated meta built from per-chunk
    // metadata only — the chunk `jsonl` payloads were released at each flush,
    // so the whole normalized file is never accumulated in heap.
    const meta = await writer.finalize();
    const columnTypes = appliedColumnTypes ?? deriveColumnTypes(headers, pictureColumns);

    // m5: an empty upload is a failure, not a 0-chunk `ready` dataset — this
    // matches the legacy upload contract (which rejects an empty file).
    if (meta.rowCount === 0) {
      throw new UploadValidationError("Uploaded file is empty", "empty_file");
    }

    // I-IDEM: a re-drive that wrote fewer chunks than a crashed prior run
    // leaves orphan `chunk-NNNNN` objects past this run's last index. Delete
    // them before flipping to `ready` so the chunk set matches `chunkCount`.
    await storage.deleteChunksFrom({
      projectId,
      datasetId,
      fromIndex: meta.chunkCount,
    });

    return { meta, columnTypes };
  }

  private async openSource(
    payload: DatasetNormalizePayload,
  ): Promise<{ bytes: AsyncIterable<Uint8Array>; sizeBytes?: number }> {
    if ("stagingKey" in payload) {
      const bytes = await this.deps.chunks.readStagedUpload({
        projectId: payload.projectId,
        stagingKey: payload.stagingKey,
      });
      return { bytes };
    }
    const source = await this.deps.storedObjects.getById({
      projectId: payload.projectId,
      id: payload.sourceStoredObjectId,
    });
    return { bytes: source.bytes, sizeBytes: source.metadata.byteLength };
  }

  /** Best-effort, as the previous release's was: the bucket lifecycle reaps what is left. */
  private async removeStaged(params: { projectId: string; stagingKey: string }): Promise<void> {
    try {
      await this.deps.chunks.removeStagedUpload(params);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
  }
}
