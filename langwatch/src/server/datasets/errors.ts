/**
 * Custom error types for dataset domain.
 * These are framework-agnostic and can be mapped to tRPC/HTTP errors in the router layer.
 */

export class DatasetNotFoundError extends Error {
  constructor(message = "Dataset not found") {
    super(message);
    this.name = "DatasetNotFoundError";
  }
}

export class DatasetConflictError extends Error {
  constructor(message = "A dataset with this name already exists") {
    super(message);
    this.name = "DatasetConflictError";
  }
}

/**
 * Thrown when a dataset's persisted columnTypes is not a valid array of {name, type} objects.
 * This indicates a data integrity issue — the schema stored in the database is corrupt.
 */
export class MalformedColumnTypesError extends Error {
  constructor(datasetName: string) {
    super(
      `Dataset "${datasetName}" has malformed columnTypes — expected an array of objects with string "name" properties`,
    );
    this.name = "MalformedColumnTypesError";
  }
}

/**
 * Thrown when a record entry contains a column name not defined in the dataset schema.
 */
export class InvalidColumnError extends Error {
  readonly columnName: string;
  readonly validColumns: string[];

  constructor({
    columnName,
    datasetName,
    validColumns,
  }: {
    columnName: string;
    datasetName: string;
    validColumns: string[];
  }) {
    const validColumnsList =
      validColumns.length > 0 ? validColumns.join(", ") : "(none)";
    super(
      `Column "${columnName}" is not defined in the "${datasetName}" dataset schema. Valid columns: ${validColumnsList}`,
    );
    this.name = "InvalidColumnError";
    this.columnName = columnName;
    this.validColumns = validColumns;
  }
}

/**
 * Thrown when direct browser→S3 upload isn't available because object storage
 * isn't configured (e.g. single-node self-hosted). The caller should fall back
 * to the backend multipart upload path.
 */
export class DirectUploadUnavailableError extends Error {
  constructor(
    message = "Direct upload is unavailable; use the backend upload path",
  ) {
    super(message);
    this.name = "DirectUploadUnavailableError";
  }
}

/** Thrown when a finalized direct upload exceeds the hard size cap. */
export class UploadTooLargeError extends Error {
  constructor(message = "Uploaded file exceeds the maximum allowed size") {
    super(message);
    this.name = "UploadTooLargeError";
  }
}

/**
 * Thrown when finalize is called on a dataset that is not in the `uploading`
 * state (e.g. re-finalizing a `processing`/`ready` dataset). Blocks finalize
 * replay; the route maps it to 409 Conflict.
 */
export class UploadNotPendingError extends Error {
  constructor(message = "Upload is not pending finalization") {
    super(message);
    this.name = "UploadNotPendingError";
  }
}

/**
 * Thrown when the staged object a finalize references is missing or incomplete
 * (never uploaded, NoSuchKey/NotFound, or a HEAD with no ContentLength). The
 * route maps it to 422; the dataset is flipped to `failed` so a never-completed
 * upload doesn't sit stuck in `uploading`.
 */
export class StagedUploadNotFoundError extends Error {
  constructor(message = "Uploaded object not found") {
    super(message);
    this.name = "StagedUploadNotFoundError";
  }
}

/**
 * Thrown when a read consumer tries to read a dataset that is not yet `ready`
 * (still `uploading`/`processing`, or `failed`). ADR-032 Decision 6 / I-READY:
 * every read consumer gates on `status='ready'` so a half-normalized or failed
 * dataset is never served as if empty. Carries the current `status` (+ optional
 * `statusError`) so the router/REST layer can surface a clear, actionable error.
 * The route maps it to 425 Too Early (a not-ready dataset is retryable once
 * preparation finishes).
 */
export class DatasetNotReadyError extends Error {
  readonly status: string;
  readonly statusError: string | null;

  constructor({
    status,
    statusError = null,
  }: {
    status: string;
    statusError?: string | null;
  }) {
    super(`Dataset is not ready (status: ${status})`);
    this.name = "DatasetNotReadyError";
    this.status = status;
    this.statusError = statusError;
  }
}

/**
 * Thrown when a manual normalize retry is requested on a dataset that can't be
 * re-run: it's not in a recoverable state (`failed`/`processing`) or it carries
 * no staging key to re-read (no source to normalize). The route maps it to 409
 * Conflict. ADR-032 I-RECOVER: a stuck dataset is recoverable, but only when
 * there's something to recover from.
 */
export class DatasetNotRetryableError extends Error {
  constructor(message = "Dataset cannot be retried") {
    super(message);
    this.name = "DatasetNotRetryableError";
  }
}

/**
 * Thrown when a chunk rewrite (edit) would produce a single chunk object larger
 * than `CHUNK_MAX_BYTES`, breaking the size invariant (Decision 2). An edit can
 * replace a small row with a large value, so a rewrite CAN grow a chunk past the
 * cap — splitting/rebalancing the chunk under the lock is the fuller fix and is
 * out of scope for this rung, so we reject (safe + correct) rather than write an
 * oversized object. Surfaced to the edit caller as a clear 4xx, not a 500.
 */
export class ChunkTooLargeError extends Error {
  readonly byteSize: number;
  readonly maxBytes: number;

  constructor({ byteSize, maxBytes }: { byteSize: number; maxBytes: number }) {
    super("Edit would exceed the maximum chunk size");
    this.name = "ChunkTooLargeError";
    this.byteSize = byteSize;
    this.maxBytes = maxBytes;
  }
}

/**
 * Thrown when a full (unbounded) export of an s3_jsonl dataset would have to
 * materialize more bytes than `DATASET_FULL_EXPORT_MAX_BYTES` in heap. The
 * bounded reads in this rung truncate at a byte budget; a download asks for the
 * whole dataset (`limitMb: null`), which on a multi-GB dataset would OOM the pod
 * (I-MEM). Reject with a clear, actionable message until the streaming-export
 * fast-follow epic ships. The route maps it to a 4xx (client must wait for
 * streaming export), not a 500.
 */
export class DatasetTooLargeToExportError extends Error {
  readonly sizeBytes: number;
  readonly maxBytes: number;

  constructor({
    sizeBytes,
    maxBytes,
  }: {
    sizeBytes: number;
    maxBytes: number;
  }) {
    super(
      "This dataset is too large to export here; streaming export is coming",
    );
    this.name = "DatasetTooLargeToExportError";
    this.sizeBytes = sizeBytes;
    this.maxBytes = maxBytes;
  }
}

/**
 * A chunk that the PG-authoritative `chunkCount` claims must exist is missing
 * from object storage. From a read's perspective this is corruption, not
 * emptiness, so the read paths (`readChunks`/`readChunk`) throw it rather than
 * silently truncate. The I-COUNT repair (`recomputeDatasetCounts`) does NOT
 * swallow it either: trailing-chunk compaction is logical-only (it lowers
 * `chunkCount` without deleting any object), so nothing reaps a chunk mid-flight
 * and any gap is genuine corruption. The repair propagates it (loud) rather than
 * re-derive a smaller `chunkCount`, which would mask a lost middle chunk whose
 * successors still survive.
 */
export class MissingChunkError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`Missing dataset chunk: ${key}`);
    this.name = "MissingChunkError";
    this.key = key;
  }
}
