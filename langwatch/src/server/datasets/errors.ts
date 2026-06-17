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
