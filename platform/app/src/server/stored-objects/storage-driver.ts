import type { Readable } from "node:stream";

/** Concrete provider byte boundary retained by application composition. */
export interface StorageDriver {
  get(uri: string): Promise<Readable>;
  put(uri: string, bytes: Buffer, mediaType: string): Promise<void>;
  delete(uri: string): Promise<void>;
  exists(uri: string): Promise<boolean>;
}
