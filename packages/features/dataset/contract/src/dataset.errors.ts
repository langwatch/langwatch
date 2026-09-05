/**
 * Custom error types for dataset domain.
 * These are framework-agnostic and can be mapped to tRPC/HTTP errors in the router layer.
 */
import { HandledError } from "@langwatch/handled-error";

export class UploadValidationError extends Error {
  readonly kind:
    | "column_mismatch"
    | "file_too_large"
    | "row_limit_exceeded"
    | "empty_file"
    | "unsupported_format";

  constructor(
    message: string,
    kind:
      | "column_mismatch"
      | "file_too_large"
      | "row_limit_exceeded"
      | "empty_file"
      | "unsupported_format",
  ) {
    super(message);
    this.name = "UploadValidationError";
    this.kind = kind;
  }
}

export class DatasetNotFoundError extends Error {
  constructor(message = "Dataset not found") {
    super(message);
    this.name = "DatasetNotFoundError";
  }
}

/**
 * A column-type change was requested on a dataset whose storage format cannot rewrite every
 * chunk's keys yet (Decision 6 defers that migration).
 */
export class ColumnTypeChangeNotSupportedError extends HandledError {
  declare readonly code: "dataset_column_type_change_unsupported";

  constructor() {
    super(
      "dataset_column_type_change_unsupported",
      // Customer-safe by construction: no storage backend, no bucket, no
      // internal format name. Which format we cannot rewrite yet is a log
      // line's business, not the customer's.
      "Changing column types is not yet supported for large datasets",
      { httpStatus: 400, fault: "customer" },
    );
    this.name = "ColumnTypeChangeNotSupportedError";
  }
}

/**
 * Which conflict a `DatasetConflictError` is. Both are 409s from PostgreSQL's point of view,
 * but they are different failures to a person: one is fixed by choosing another name, the other
 * by reloading the editor.
 */
export type DatasetConflictReason = "name_taken" | "stale_columns";

export class DatasetConflictError extends Error {
  readonly reason: DatasetConflictReason;

  constructor(
    message = "A dataset with this name already exists",
    options: { reason?: DatasetConflictReason } = {},
  ) {
    super(message);
    this.name = "DatasetConflictError";
    this.reason = options.reason ?? "name_taken";
  }
}

/**
 * The handled-error form of `DatasetConflictError` (ADR-045).
 */
export class DatasetNameTakenError extends HandledError {
  declare readonly code: "dataset_name_taken";

  constructor() {
    super("dataset_name_taken", "A dataset with this name already exists", {
      httpStatus: 409,
      fault: "customer",
    });
    this.name = "DatasetNameTakenError";
  }
}

/**
 * The editor's view of the dataset's columns is behind the stored one — a concurrent column
 * edit already rewrote the chunks — so the write is refused before anything is written
 * (optimistic concurrency, no partial rewrite).
 */
export class DatasetStaleColumnsError extends HandledError {
  declare readonly code: "dataset_stale_columns";

  constructor() {
    super("dataset_stale_columns", "This dataset's columns changed since the editor was opened", {
      httpStatus: 409,
      fault: "customer",
    });
    this.name = "DatasetStaleColumnsError";
  }
}

/**
 * Thrown when a write would persist two rows with the same id.
 */
export class DuplicateRecordIdError extends Error {
  constructor(id: string) {
    super(`Duplicate record id "${id}" in the same write`);
    this.name = "DuplicateRecordIdError";
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
    const validColumnsList = validColumns.length > 0 ? validColumns.join(", ") : "(none)";
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
  constructor(message = "Direct upload is unavailable; use the backend upload path") {
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
 * Thrown when the staged object a finalize references is missing or incomplete (never uploaded,
 * NoSuchKey/NotFound, or a HEAD with no ContentLength). The route maps it to 422; the dataset
 * is flipped to `failed` so a never-completed upload doesn't sit stuck in `uploading`.
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
 */
export class DatasetNotReadyError extends HandledError {
  declare readonly code: "dataset_not_ready";

  readonly status: string;
  readonly statusError: string | null;

  constructor({ status, statusError = null }: { status: string; statusError?: string | null }) {
    super("dataset_not_ready", `Dataset is not ready (status: ${status})`, {
      meta: { status },
      httpStatus: 425,
      fault: "customer",
    });
    this.name = "DatasetNotReadyError";
    this.status = status;
    this.statusError = statusError;
  }
}

/**
 * Thrown when a manual normalize retry is requested on a dataset that can't
 * be re-run: not in a recoverable state, or no staging key to re-read. Maps to 409 Conflict.
 * ADR-032 I-RECOVER: a stuck dataset is recoverable, but only when there's something to recover from.
 */
export class DatasetNotRetryableError extends Error {
  constructor(message = "Dataset cannot be retried") {
    super(message);
    this.name = "DatasetNotRetryableError";
  }
}

/**
 * Thrown when a chunk rewrite (edit) would produce a single chunk object larger than
 * `CHUNK_MAX_BYTES`, breaking the size invariant (Decision 2).
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
 * Thrown when a full (unbounded) export of an s3_jsonl dataset would have to materialize more
 * bytes than `DATASET_FULL_EXPORT_MAX_BYTES` in heap.
 */
export class DatasetTooLargeToExportError extends Error {
  readonly sizeBytes: number;
  readonly maxBytes: number;

  constructor({ sizeBytes, maxBytes }: { sizeBytes: number; maxBytes: number }) {
    super("This dataset is too large to export here; streaming export is coming");
    this.name = "DatasetTooLargeToExportError";
    this.sizeBytes = sizeBytes;
    this.maxBytes = maxBytes;
  }
}

/**
 * Changing a column's type on an `s3_jsonl` dataset rewrites every chunk (rename +
 * type-convert) by buffering the dataset's rows in memory for the duration of
 * the advisory-locked transaction (ADR-032 v19). That buffer is bounded ONLY by
 */
export class DatasetTooLargeToEditColumnsError extends Error {
  readonly sizeBytes: number;
  readonly maxBytes: number;

  constructor({ sizeBytes, maxBytes }: { sizeBytes: number; maxBytes: number }) {
    super(
      "This dataset is too large to change column types in place yet. Reduce its size or contact support.",
    );
    this.name = "DatasetTooLargeToEditColumnsError";
    this.sizeBytes = sizeBytes;
    this.maxBytes = maxBytes;
  }
}

/**
 * A chunk that the PG-authoritative `chunkCount` claims must exist is missing from object
 * storage. From a read's perspective this is corruption, not emptiness, so the read paths
 * (`readChunks`/`readChunk`) throw it rather than silently truncate.
 */
export class MissingChunkError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`Missing dataset chunk: ${key}`);
    this.name = "MissingChunkError";
    this.key = key;
  }
}

/**
 * An s3_jsonl dataset is `ready` but its PG-authoritative `chunkCount` is null — an I-COUNT
 * integrity violation (a transiently-failed `UPDATE` after migrate / normalize, never a valid
 * resting state).
 */
export class DatasetChunkCountMissingError extends Error {
  readonly datasetId: string;

  constructor(datasetId: string) {
    super(`Dataset ${datasetId} has s3_jsonl layout but a null chunkCount (I-COUNT drift)`);
    this.name = "DatasetChunkCountMissingError";
    this.datasetId = datasetId;
  }
}

/**
 * The local-FS storage root is not writable (EACCES/EROFS/EPERM) — born-on- storage made a
 * writable backend mandatory, so this is a deployment-config error, not a transient failure.
 * fix, so per ADR-045 it crosses the boundary as a handled error under
 */
export class StorageNotWritableError extends HandledError {
  declare readonly code: "storage_not_writable";

  constructor() {
    super("storage_not_writable", "Dataset storage is not writable, so nothing was saved", {
      httpStatus: 500,
      fault: "platform",
    });
    this.name = "StorageNotWritableError";
  }
}

export class DatasetRecordNotFoundError extends Error {
  constructor(message = "Dataset record not found") {
    super(message);
    this.name = "DatasetRecordNotFoundError";
  }
}
