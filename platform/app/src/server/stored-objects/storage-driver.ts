/**
 * StorageDriver — pluggable interface for stored-object byte content.
 *
 * Concrete implementations (S3Driver, LocalFilesystemDriver) are registered
 * in the StorageRegistry and selected at runtime by URI scheme.
 */
import type { Readable } from "node:stream";

/**
 * Pluggable backend for reading and writing stored-object byte content.
 * All operations are keyed by a content-addressed URI (e.g. s3://... or file://...).
 */
export interface StorageDriver {
  /** Returns a readable stream for the object at the given URI. */
  get(uri: string): Promise<Readable>;

  /** Writes bytes to the given URI with the specified media type. */
  put(uri: string, bytes: Buffer, mediaType: string): Promise<void>;

  /** Deletes the object at the given URI. */
  delete(uri: string): Promise<void>;

  /** Returns true if an object exists at the given URI. */
  exists(uri: string): Promise<boolean>;
}
