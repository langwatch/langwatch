/**
 * StorageRegistry — scheme-dispatch registry for StorageDriver instances.
 *
 * S3 and file drivers are always registered. Azure may be registered lazily
 * so historical URIs remain readable without validating Azure configuration
 * on requests that dispatch to another scheme.
 */
import type { Readable } from "node:stream";
import { redactStorageUri } from "./project-storage-destination";
import type { StorageDriver } from "./storage-driver";
import type { UriScheme } from "./uri";
import { getUriScheme } from "./uri";

type StorageDriverFactory = () => StorageDriver | undefined;

/**
 * Routes storage operations to the correct driver by extracting the URI scheme.
 *
 * The `azure-blob` driver is optional and may be supplied as a factory:
 * deployments that have not configured Azure credentials don't construct it,
 * and inactive Azure configuration cannot block S3/file traffic. The registry
 * throws a descriptive error if a URI of an unregistered scheme is dispatched.
 *
 * The field uses `Partial<Record<UriScheme, StorageDriver>>` so that adding
 * a new scheme only requires one constant change in uri.ts — no field or
 * constructor edits needed here. The constructor still requires s3 and file
 * explicitly so callers can't accidentally omit the mandatory drivers.
 */
export class StorageRegistry {
  private readonly drivers: Partial<Record<UriScheme, StorageDriver>>;
  private readonly driverFactories: Partial<Record<UriScheme, StorageDriverFactory>>;

  constructor({
    s3,
    file,
    "azure-blob": azureBlob,
  }: {
    s3: StorageDriver;
    file: StorageDriver;
    "azure-blob"?: StorageDriver | StorageDriverFactory;
  }) {
    this.drivers = { s3, file };
    this.driverFactories = {};

    if (typeof azureBlob === "function") {
      this.driverFactories["azure-blob"] = azureBlob;
    } else {
      this.drivers["azure-blob"] = azureBlob;
    }
  }

  private driverFor(uri: string): StorageDriver {
    const scheme = getUriScheme(uri);
    let driver = this.drivers[scheme];
    const factory = this.driverFactories[scheme];
    if (!driver && factory) {
      driver = factory();
      if (driver) {
        this.drivers[scheme] = driver;
      }
    }
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
