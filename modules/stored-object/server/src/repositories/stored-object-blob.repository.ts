/**
 * The blob row of the stored-object module: object bytes addressed by their
 * storage URI, one provider behind each scheme. Every tier reads and writes
 * the same four operations, so a caller that holds one of them cannot tell
 * S3 from Azure Blob from the local filesystem from the in-memory twin.
 *
 * The URI carries the tenant, because the scheme registry resolves the
 * provider from it before the bytes are touched.
 */
import type { Readable } from "node:stream";

export interface StoredObjectStorageDriver {
  /** Streams the bytes stored at `uri`, rejecting when there are none. */
  get(uri: string): Promise<Readable>;

  /** Writes `bytes` at `uri`, replacing whatever was there. */
  put(uri: string, bytes: Buffer, mediaType: string): Promise<void>;

  /** Removes the bytes at `uri`; a URI with no bytes is not an error. */
  delete(uri: string): Promise<void>;

  /** Answers whether `uri` currently holds bytes. */
  exists(uri: string): Promise<boolean>;
}

/**
 * A provider the scheme registry builds on first use rather than at compose
 * time, for a backend whose credentials are not resolved yet.
 */
export type StoredObjectStorageDriverFactory = () => StoredObjectStorageDriver | undefined;
