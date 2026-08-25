import type { Readable } from "node:stream";
import {
  getStoredObjectStorageScheme,
  redactStoredObjectStorageUri,
  type StoredObjectStorageScheme,
} from "@langwatch/stored-object-contract";
import type { StorageDriver } from "./storage-driver";

type StorageDriverFactory = () => StorageDriver | undefined;

/**
 * App-side provider composition. It preserves lazy Azure construction so an
 * inactive Azure setup cannot prevent S3 and filesystem byte traffic.
 */
export class StorageRegistry {
  private readonly drivers: Partial<Record<StoredObjectStorageScheme, StorageDriver>>;
  private readonly factories: Partial<
    Record<StoredObjectStorageScheme, StorageDriverFactory>
  >;

  constructor(input: {
    s3: StorageDriver;
    file: StorageDriver;
    "azure-blob"?: StorageDriver | StorageDriverFactory;
  }) {
    this.drivers = { s3: input.s3, file: input.file };
    this.factories = {};
    const azure = input["azure-blob"];
    if (typeof azure === "function") {
      this.factories["azure-blob"] = azure;
    } else if (azure) {
      this.drivers["azure-blob"] = azure;
    }
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

  private driverFor(uri: string): StorageDriver {
    const scheme = getStoredObjectStorageScheme(uri);
    let driver = this.drivers[scheme];
    const factory = this.factories[scheme];
    if (!driver && factory) {
      driver = factory();
      if (driver) {
        this.drivers[scheme] = driver;
      }
    }
    if (!driver) {
      throw new Error(
        `Storage scheme "${scheme}" is not configured in this deployment (uri: ${redactStoredObjectStorageUri(uri)})`,
      );
    }
    return driver;
  }
}
