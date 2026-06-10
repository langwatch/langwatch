/**
 * StorageRegistry — scheme-dispatch registry for StorageDriver instances.
 *
 * Both drivers are always registered so historical URIs of any scheme
 * remain readable after a deployment swaps the active minting backend.
 */
import type { Readable } from "node:stream";
import { redactStorageUri } from "./project-storage-destination";
import type { StorageDriver } from "./storage-driver";
import { getUriScheme } from "./uri";
import type { UriScheme } from "./uri";

/**
 * Routes storage operations to the correct driver by extracting the URI scheme.
 *
 * The `azure-blob` driver is optional: deployments that have not configured
 * Azure credentials don't need it registered. The registry throws a
 * descriptive error if a URI of an unregistered scheme is dispatched.
 *
 * The field uses `Partial<Record<UriScheme, StorageDriver>>` so that adding
 * a new scheme only requires one constant change in uri.ts — no field or
 * constructor edits needed here. The constructor still requires s3 and file
 * explicitly so callers can't accidentally omit the mandatory drivers.
 */
export class StorageRegistry {
  private readonly drivers: Partial<Record<UriScheme, StorageDriver>>;

  constructor({
    s3,
    file,
    "azure-blob": azureBlob,
  }: {
    s3: StorageDriver;
    file: StorageDriver;
    "azure-blob"?: StorageDriver;
  }) {
    this.drivers = { s3, file, "azure-blob": azureBlob };
  }

  private driverFor(uri: string): StorageDriver {
    const scheme = getUriScheme(uri);
    const driver = this.drivers[scheme];
    if (!driver) {
      throw new Error(
        `Storage scheme "${scheme}" is not configured in this deployment (uri: ${redactStorageUri(uri)})`,
      );
    }
    return driver;
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
