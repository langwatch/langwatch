/**
 * Custom error types for dataset domain.
 * These are framework-agnostic and can be mapped to tRPC/HTTP errors in the router layer.
 */
import { HandledError } from "@langwatch/handled-error";
import { REFUSED_ATTACHMENT_MEDIA_TYPES } from "@langwatch/stored-object-contract";

import { formatDatasetByteLimit, formatDatasetRowLimit } from "./dataset-limits.ts";

export type UploadRefusal =
  | "column_mismatch"
  | "file_too_large"
  | "row_limit_exceeded"
  | "empty_file"
  | "unsupported_format";

const BAD_REQUEST_REFUSALS: ReadonlySet<UploadRefusal> = new Set([
  "file_too_large",
  "row_limit_exceeded",
  "column_mismatch",
]);

/** A posted or imported file the dataset cannot take; too big, too long or mismatched is a 400. */
export class UploadValidationError extends HandledError {
  declare readonly code: "validation_error";
  readonly kind: UploadRefusal;

  constructor(message: string, kind: UploadRefusal) {
    super("validation_error", message, {
      httpStatus: BAD_REQUEST_REFUSALS.has(kind) ? 400 : 422,
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

export class DatasetConflictError extends HandledError {
  declare readonly code: "dataset_conflict";

  constructor(message = "A dataset with this name already exists") {
    super("dataset_conflict", message, { httpStatus: 409, fault: "customer" });
    this.name = "DatasetConflictError";
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
export class DatasetNotRetryableError extends HandledError {
  declare readonly code: "dataset_not_retryable";

  constructor(message = "Dataset cannot be retried") {
    super("dataset_not_retryable", message, { httpStatus: 409, fault: "customer" });
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

/** A search would read more rows or bytes than the organization's whole-read limits. */
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

/** A download of every row would hold more than the organization's whole-read limits. */
export class DatasetTooLargeToExportError extends HandledError {
  declare readonly code: "dataset_too_large_to_export";

  constructor(
    params: { rowCount: number; maxRows: number } | { sizeBytes?: number; maxBytes: number },
  ) {
    const limit =
      "maxRows" in params
        ? `${formatDatasetRowLimit(params.maxRows)} rows`
        : formatDatasetByteLimit(params.maxBytes);
    super(
      "dataset_too_large_to_export",
      `This dataset holds more than the ${limit} one download carries. ` +
        "Read it page by page from GET /api/dataset/{slugOrId}/records.",
      { httpStatus: 413, fault: "customer", meta: { ...params } },
    );
    this.name = "DatasetTooLargeToExportError";
  }
}

/**
 * Changing a column's type on an `s3_jsonl` dataset rewrites every chunk (rename +
 * type-convert) by buffering the dataset's rows in memory for the duration of
 * the advisory-locked transaction (ADR-032 v19). That buffer is bounded ONLY by
 */
export class DatasetTooLargeToEditColumnsError extends HandledError {
  declare readonly code: "dataset_too_large_to_edit_columns";
  readonly sizeBytes: number;
  readonly maxBytes: number;

  constructor({ sizeBytes, maxBytes }: { sizeBytes: number; maxBytes: number }) {
    super(
      "dataset_too_large_to_edit_columns",
      "This dataset is too large to change column types in place yet. Reduce its size or contact support.",
      { httpStatus: 413, fault: "customer", meta: { sizeBytes, maxBytes } },
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
    super(
      "dataset_attachment_too_large",
      `The file is larger than the ${formatDatasetByteLimit(maxBytes)} limit for one file`,
      {
        meta: { maxBytes },
        httpStatus: 413,
        fault: "customer",
      },
    );
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

/**
 * The whole dataset does not fit one response. The caller reads it page by
 * page instead, which has no size ceiling.
 */
export class DatasetTooLargeToReadInlineError extends HandledError {
  declare readonly code: "dataset_too_large_to_read_inline";

  constructor({ maxBytes, totalRows }: { maxBytes: number; totalRows: number }) {
    super(
      "dataset_too_large_to_read_inline",
      `This dataset is larger than the ${formatDatasetByteLimit(maxBytes)} one response carries. ` +
        "Read it page by page from GET /api/dataset/{slugOrId}/records with the page and limit parameters.",
      { httpStatus: 400, fault: "customer", meta: { maxBytes, totalRows } },
    );
    this.name = "DatasetTooLargeToReadInlineError";
  }
}

/**
 * One page of records does not fit one response. `meta.suggestedLimit` divides
 * the limit the caller asked for, so the caller continues from page
 * `(page - 1) * limit / suggestedLimit + 1` without skipping or repeating a row.
 */
export class DatasetPageTooLargeError extends HandledError {
  declare readonly code: "dataset_page_too_large";

  constructor({
    maxBytes,
    page,
    limit,
    suggestedLimit,
  }: {
    maxBytes: number;
    page: number;
    limit: number;
    suggestedLimit: number;
  }) {
    super(
      "dataset_page_too_large",
      `This page of ${limit} records is larger than the ${formatDatasetByteLimit(maxBytes)} one response carries. ` +
        `Ask again with limit=${suggestedLimit}.`,
      {
        httpStatus: 413,
        fault: "customer",
        meta: {
          maxBytes,
          page,
          limit,
          suggestedLimit,
          suggestedPage: ((page - 1) * limit) / suggestedLimit + 1,
        },
      },
    );
    this.name = "DatasetPageTooLargeError";
  }
}

/** Where a row was measured: as it arrived in a file, or as the dataset stores it. */
export type DatasetRowMeasure = "uploaded" | "stored";

/** One row is over the size a dataset takes; `meta.maxBytes` is the number the copy shows. */
export class DatasetRowTooLargeError extends HandledError {
  declare readonly code: "dataset_row_too_large";

  constructor({ maxBytes, measure }: { maxBytes: number; measure: DatasetRowMeasure }) {
    super(
      "dataset_row_too_large",
      measure === "uploaded"
        ? `A row in the file is larger than the ${formatDatasetByteLimit(maxBytes)} limit for one row`
        : `A row is larger than the ${formatDatasetByteLimit(maxBytes)} a dataset stores for one row. ` +
            "Put files in an image or file column so they are stored beside the row.",
      { httpStatus: 413, fault: "customer", meta: { maxBytes, measure } },
    );
    this.name = "DatasetRowTooLargeError";
  }
}

/** An image or file cell held inline content that is not readable base64. */
export class DatasetInlineFileUnreadableError extends HandledError {
  declare readonly code: "dataset_inline_file_unreadable";

  constructor(column: string) {
    super(
      "dataset_inline_file_unreadable",
      `The inline file in column "${column}" is not valid base64 content`,
      { httpStatus: 422, fault: "customer", meta: { column } },
    );
    this.name = "DatasetInlineFileUnreadableError";
  }
}
