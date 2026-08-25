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

export class DatasetNotReadyError extends Error {
  readonly status: string | null;
  readonly statusError: string | null;

  constructor(
    options:
      | { status?: string | null; statusError?: string | null }
      | string = "Dataset is not ready",
  ) {
    const message = typeof options === "string" ? options : "Dataset is not ready";
    super(message);
    this.name = "DatasetNotReadyError";
    this.status = typeof options === "string" ? null : (options.status ?? null);
    this.statusError = typeof options === "string" ? null : (options.statusError ?? null);
  }
}

export class DatasetRecordNotFoundError extends Error {
  constructor(message = "Dataset record not found") {
    super(message);
    this.name = "DatasetRecordNotFoundError";
  }
}

export class UploadValidationError extends Error {
  readonly kind:
    | "column_mismatch"
    | "file_too_large"
    | "row_limit_exceeded"
    | "empty_file"
    | "unsupported_format";

  constructor(
    message: string,
    kind: UploadValidationError["kind"] = "unsupported_format",
  ) {
    super(message);
    this.name = "UploadValidationError";
    this.kind = kind;
  }
}

export class ChunkTooLargeError extends Error {
  constructor(message = "Dataset chunk is too large") {
    super(message);
    this.name = "ChunkTooLargeError";
  }
}

export class DatasetTooLargeToExportError extends Error {
  constructor(message = "Dataset is too large to export in memory") {
    super(message);
    this.name = "DatasetTooLargeToExportError";
  }
}

export class DuplicateRecordIdError extends Error {
  constructor(message = "Dataset record id is duplicated") {
    super(message);
    this.name = "DuplicateRecordIdError";
  }
}
