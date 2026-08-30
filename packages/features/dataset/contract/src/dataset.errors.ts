/**
 * The one dataset error the shared contract still declares.
 *
 * The other seven that used to live here — DatasetNotFoundError,
 * DatasetConflictError, DatasetNotReadyError, UploadValidationError,
 * ChunkTooLargeError, DatasetTooLargeToExportError and DuplicateRecordIdError —
 * each had a same-named class in `@langwatch/dataset-server`. Only the server's
 * were ever thrown, so every `instanceof` against these was false and six
 * mappings that looked present returned 500 instead of the 4xx they named. One
 * class per failure now, and it lives beside the code that raises it.
 */
export class DatasetRecordNotFoundError extends Error {
  constructor(message = "Dataset record not found") {
    super(message);
    this.name = "DatasetRecordNotFoundError";
  }
}
