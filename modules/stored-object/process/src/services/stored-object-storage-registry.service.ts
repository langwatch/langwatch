import type { Readable } from "node:stream";

import {
  getStoredObjectStorageScheme,
  redactStoredObjectStorageUri,
  type StoredObjectStorageScheme,
} from "@langwatch/stored-object-contract";

import type {
  StoredObjectStorageDriver,
  StoredObjectStorageDriverFactory,
} from "#repositories/stored-object-blob.repository";

import { StoredObjectStorageRepository } from "../repositories/stored-object-storage.repository.ts";

/**
 * Provider-neutral scheme dispatch owned by Stored Objects.
 */
export class StoredObjectStorageRegistryAdapter extends StoredObjectStorageRepository {
  static create(input: {
    s3: StoredObjectStorageDriver;
    file: StoredObjectStorageDriver;
    "azure-blob"?: StoredObjectStorageDriver | StoredObjectStorageDriverFactory;
  }): StoredObjectStorageRegistryAdapter {
    return new StoredObjectStorageRegistryAdapter(input);
  }

  private constructor(input: {
    s3: StoredObjectStorageDriver;
    file: StoredObjectStorageDriver;
    "azure-blob"?: StoredObjectStorageDriver | StoredObjectStorageDriverFactory;
  }) {
    super();
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

  // Arrow instance properties, not prototype methods: the base class declares
  // these members as properties of function type (so tests can reference a
  // mock's methods unbound without tripping `typescript/unbound-method`), and
  // TypeScript requires a subclass to match that declaration shape exactly
  // (TS2425).
  get = (uri: string): Promise<Readable> => {
    return this.driverFor(uri).get(uri);
  };

  put = (uri: string, bytes: Buffer, mediaType: string): Promise<void> => {
    return this.driverFor(uri).put(uri, bytes, mediaType);
  };

  delete = (uri: string): Promise<void> => {
    return this.driverFor(uri).delete(uri);
  };

  exists = (uri: string): Promise<boolean> => {
    return this.driverFor(uri).exists(uri);
  };

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
