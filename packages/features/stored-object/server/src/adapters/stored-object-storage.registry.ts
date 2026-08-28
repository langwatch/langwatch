import type { Readable } from "node:stream";
import {
  getStoredObjectStorageScheme,
  redactStoredObjectStorageUri,
  type StoredObjectStorageScheme,
} from "@langwatch/stored-object-contract";

/** Provider byte operations supplied by process composition. */
export interface StoredObjectStorageDriver {
  get(uri: string): Promise<Readable>;
  put(uri: string, bytes: Buffer, mediaType: string): Promise<void>;
  delete(uri: string): Promise<void>;
  exists(uri: string): Promise<boolean>;
}

export type StoredObjectStorageDriverFactory = () => StoredObjectStorageDriver | undefined;

/**
 * Provider-neutral scheme dispatch owned by Stored Objects.
 *
 * The app and Worker roots supply drivers and configuration; this registry
 * owns only dispatch and Azure's lazy registration policy. In particular, a
 * configured Azure read driver is not constructed until an azure-blob URI is
 * actually read.
 */
export class StoredObjectStorageRegistry {
  constructor(input: {
    s3: StoredObjectStorageDriver;
    file: StoredObjectStorageDriver;
    "azure-blob"?: StoredObjectStorageDriver | StoredObjectStorageDriverFactory;
  }) {
    this.drivers = { s3: input.s3, file: input.file };
    const azure = input["azure-blob"];
    if (typeof azure === "function") {
      this.factories["azure-blob"] = azure;
    } else if (azure) {
      this.drivers["azure-blob"] = azure;
    }
  }

  private readonly drivers: Partial<Record<StoredObjectStorageScheme, StoredObjectStorageDriver>>;
  private readonly factories: Partial<
    Record<StoredObjectStorageScheme, StoredObjectStorageDriverFactory>
  > = {};

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

  private driverFor(uri: string): StoredObjectStorageDriver {
    const scheme = getStoredObjectStorageScheme(uri);
    let driver = this.drivers[scheme];
    const factory = this.factories[scheme];
    if (!driver && factory) {
      driver = factory();
      if (driver) this.drivers[scheme] = driver;
    }
    if (!driver) {
      throw new Error(
        `Storage scheme "${scheme}" is not configured in this deployment (uri: ${redactStoredObjectStorageUri(uri)})`,
      );
    }
    return driver;
  }
}
