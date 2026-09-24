/**
 * Custom error types for dataset domain.
 * These are framework-agnostic and can be mapped to tRPC/HTTP errors in the router layer.
 */
import { HandledError } from "@langwatch/handled-error";
import { REFUSED_ATTACHMENT_MEDIA_TYPES } from "@langwatch/stored-object-contract";

export type UploadRefusal =
  | "column_mismatch"
  | "file_too_large"
  | "row_limit_exceeded"
  | "empty_file"
  | "unsupported_format";

/** A posted or imported file the dataset cannot take; too large or too long is a 400. */
export class UploadValidationError extends HandledError {
  declare readonly code: "validation_error";
  readonly kind: UploadRefusal;

  constructor(message: string, kind: UploadRefusal) {
    super("validation_error", message, {
      httpStatus: kind === "file_too_large" || kind === "row_limit_exceeded" ? 400 : 422,
      fault: "customer",
      meta: { fieldErrors: { file: [message] } },
    });
    this.name = "UploadValidationError";
    this.kind = kind;
  }
}

/**
 * The dataset the caller named is archived, in another project, or gone. The
 * caller can act on it — pick another dataset — so it crosses the boundary as
 * a handled 404 rather than an unknown failure (ADR-045).
 */
export class DatasetNotFoundError extends HandledError {
  declare readonly code: "dataset_not_found";

  constructor(message = "Dataset not found") {
    super("dataset_not_found", message, { httpStatus: 404, fault: "customer" });
    this.name = "DatasetNotFoundError";
  }
}

/**
 * An entries or recordIds batch above the plan's bound. Refused rather than
 * silently truncated: a write that drops rows is worse than one that says no,
 * and the caller can split the batch and retry.
 */
export class DatasetBatchTooLargeError extends HandledError {
  declare readonly code: "dataset_batch_too_large";

  constructor({ count, maxEntries }: { count: number; maxEntries: number }) {
    super(
      "dataset_batch_too_large",
      `A dataset batch accepts at most ${maxEntries} entries under this plan; this one carried ${count}. Split it into smaller batches.`,
      { httpStatus: 422, fault: "customer", meta: { count, maxEntries } },
    );
    this.name = "DatasetBatchTooLargeError";
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
export class DuplicateRecordIdError extends HandledError {
  declare readonly code: "dataset_duplicate_record_id";

  constructor(id: string) {
    super("dataset_duplicate_record_id", `Duplicate record id "${id}" in the same write`, {
      httpStatus: 409,
      fault: "customer",
      meta: { recordId: id },
    });
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

/** Thrown when a retry names a dataset that has no failed or stuck import to run again. */
export class UploadNotPendingError extends HandledError {
  declare readonly code: "dataset_upload_not_pending";

  constructor(message = "Upload is not pending finalization") {
    super("dataset_upload_not_pending", message, { httpStatus: 409, fault: "customer" });
    this.name = "UploadNotPendingError";
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
 * Thrown when a normalize retry is requested on a dataset that can't be
 * re-run: not recoverable, or no staging key to re-read. Maps to 409.
 * ADR-032 I-RECOVER: recoverable only when there's something to recover from.
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
export class ChunkTooLargeError extends HandledError {
  declare readonly code: "dataset_chunk_too_large";

  readonly byteSize: number;
  readonly maxBytes: number;

  constructor({ byteSize, maxBytes }: { byteSize: number; maxBytes: number }) {
    super("dataset_chunk_too_large", "Edit would exceed the maximum chunk size", {
      httpStatus: 400,
      fault: "customer",
      meta: { byteSize, maxBytes },
    });
    this.name = "ChunkTooLargeError";
    this.byteSize = byteSize;
    this.maxBytes = maxBytes;
  }
}

/**
 * Thrown when a full (unbounded) export of an s3_jsonl dataset would have to materialize more
 * bytes than `DATASET_FULL_EXPORT_MAX_BYTES` in heap.
 */
export class DatasetTooLargeToSearchError extends HandledError {
  declare readonly code: "dataset_too_large_to_search";

  readonly measured: number;
  readonly limit: number;
  readonly dimension: "rows" | "bytes";

  constructor(
    params: { rowCount: number; maxRows: number } | { sizeBytes: number; maxBytes: number },
  ) {
    const rows = "rowCount" in params;
    const measured = rows ? params.rowCount : params.sizeBytes;
    const limit = rows ? params.maxRows : params.maxBytes;
    const dimension = rows ? "rows" : "bytes";
    super(
      "dataset_too_large_to_search",
      `Dataset holds ${measured} ${dimension}, more than the ${limit} a single search will read`,
      { fault: "customer" },
    );
    this.name = "DatasetTooLargeToSearchError";
    this.measured = measured;
    this.limit = limit;
    this.dimension = dimension;
  }
}

export class DatasetTooLargeToExportError extends HandledError {
  declare readonly code: "dataset_too_large_to_export";

  readonly sizeBytes: number;
  readonly maxBytes: number;

  constructor({ sizeBytes, maxBytes }: { sizeBytes: number; maxBytes: number }) {
    super(
      "dataset_too_large_to_export",
      "This dataset is too large to export here; streaming export is coming",
      { httpStatus: 413, fault: "customer", meta: { sizeBytes, maxBytes } },
    );
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

export class DatasetRecordNotFoundError extends Error {
  constructor(message = "Dataset record not found") {
    super(message);
    this.name = "DatasetRecordNotFoundError";
  }
}

/** The file is over the ceiling; `meta.maxBytes` is the number the copy shows. */
export class DatasetAttachmentTooLargeError extends HandledError {
  declare readonly code: "dataset_attachment_too_large";

  constructor(maxBytes: number) {
    super("dataset_attachment_too_large", "Dataset attachment is over the size ceiling", {
      meta: { maxBytes },
      httpStatus: 413,
      fault: "customer",
    });
    this.name = "DatasetAttachmentTooLargeError";
  }
}

/** The file is of a type a browser can run; `meta.refused` is our own list, not customer input. */
export class DatasetAttachmentTypeRefusedError extends HandledError {
  declare readonly code: "dataset_attachment_type_refused";

  constructor(mediaType: string) {
    super("dataset_attachment_type_refused", "Dataset attachment media type is not accepted", {
      meta: { mediaType, refused: [...REFUSED_ATTACHMENT_MEDIA_TYPES] },
      httpStatus: 415,
      fault: "customer",
    });
    this.name = "DatasetAttachmentTypeRefusedError";
  }
}

/** A file the row names that the run cannot read; `meta.fileName` tells the reader which cell. */
export class DatasetAttachmentUnavailableError extends HandledError {
  declare readonly code: "dataset_attachment_unavailable";

  constructor(fileName: string) {
    super("dataset_attachment_unavailable", `The attachment "${fileName}" could not be read.`, {
      httpStatus: 400,
      fault: "customer",
      meta: { fileName },
    });
    this.name = "DatasetAttachmentUnavailableError";
  }
}

export type DatasetStoredObjectRefusal =
  | "not_found"
  | "not_confirmed"
  | "wrong_purpose"
  | "unsupported_format";

/** A cell names a stored file this dataset cannot hold (ADR-158 §6). */
export class DatasetAttachmentReferenceRefusedError extends HandledError {
  declare readonly code: "dataset_attachment_reference_refused";

  constructor(input: { reason: DatasetStoredObjectRefusal; column: string }) {
    super("dataset_attachment_reference_refused", "A cell holds a file that is not available", {
      httpStatus: 422,
      fault: "customer",
      meta: { reason: input.reason, column: input.column },
    });
    this.name = "DatasetAttachmentReferenceRefusedError";
  }
}

/** The file a dataset is built from is missing, unconfirmed or not a dataset import. */
export class DatasetImportSourceRefusedError extends HandledError {
  declare readonly code: "dataset_import_source_refused";

  constructor(reason: DatasetStoredObjectRefusal) {
    super("dataset_import_source_refused", "The file is not available as a dataset import", {
      httpStatus: 422,
      fault: "customer",
      meta: { reason },
    });
    this.name = "DatasetImportSourceRefusedError";
  }
}
