/**
 * StorageRegistry — scheme-dispatch registry for StorageDriver instances.
 *
 * Both drivers are always registered so historical URIs of any scheme
 * remain readable after a deployment swaps the active minting backend.
 */
import type { Readable } from "node:stream";
import type { StorageDriver } from "./storage-driver";
import { getUriScheme } from "./uri";

/**
 * Routes storage operations to the correct driver by extracting the URI scheme.
 */
export class StorageRegistry {
  private readonly drivers: { s3: StorageDriver; file: StorageDriver };

  constructor({ s3, file }: { s3: StorageDriver; file: StorageDriver }) {
    this.drivers = { s3, file };
  }

  private driverFor(uri: string): StorageDriver {
    const scheme = getUriScheme(uri);
    return this.drivers[scheme];
  }

  get(uri: string): Promise<Readable> {
    return this.driverFor(uri).get(uri);
  }

  put(uri: string, bytes: Buffer, mediaType: string): Promise<void> {
    return this.driverFor(uri).put(uri, bytes, mediaType);
  }

  delete(uri: string): Promise<void> {
    return this.driverFor(uri).delete(uri);
  }

  exists(uri: string): Promise<boolean> {
    return this.driverFor(uri).exists(uri);
  }
}
