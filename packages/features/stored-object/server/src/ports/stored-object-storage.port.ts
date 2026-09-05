/**
 * Byte I/O for stored objects, addressed by storage URI.
 *
 * The service holds this port; the registry in `adapters/` implements it by
 * dispatching on the URI's scheme to whichever provider drivers the process
 * composed.
 */
import type { Readable } from "node:stream";

export abstract class StoredObjectStoragePort {
  abstract get(uri: string): Promise<Readable>;
  abstract put(uri: string, bytes: Buffer, mediaType: string): Promise<void>;
  abstract delete(uri: string): Promise<void>;
  abstract exists(uri: string): Promise<boolean>;
}
