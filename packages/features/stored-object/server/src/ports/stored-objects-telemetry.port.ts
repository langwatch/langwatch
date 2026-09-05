/**
 * What the content-addressed store reports about its own work.
 */
export abstract class StoredObjectsTelemetryPort {
  /** One `storeFromBytes` call arrived, whatever it went on to do. */
  abstract recordExtract(purpose: string): void;
  /** The content was already held for this project, so nothing was written. */
  abstract recordDedupHit(purpose: string): void;
  /** The storage backend refused a write, or the row insert after it failed. */
  abstract recordWriteFailure(purpose: string): void;
  /** A read reached the storage backend and it failed for anything but a 404. */
  abstract recordReadFailure(): void;
  /** The payload size one call carried. */
  abstract observeSizeBytes(purpose: string, bytes: number): void;
}
