/**
 * The stored-object feature's application. Two shapes of read reach an object
 * and they are not one operation: the portable capability answers metadata and
 * an async iterable, the byte surface needs the ROW. Each has its own name.
 */
import type { Readable } from "node:stream";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { StoredObjectApi } from "@langwatch/stored-object-contract";
import type {
  DeleteProjectStoredObjectsResult,
  ReadStoredObjectResult,
  StoreStoredObjectFromBytesInput,
  StoreStoredObjectFromBytesResult,
  StoredObjectFileRow,
  StoredObjectHead,
  StoredObjectIdDeriver,
  StoredObjectMetadata,
  StoredObjectOwnerResolver,
  StoredObjectReference,
  StoredObjectsConfirmUploadInput,
  StoredObjectsCreateUploadInput,
  StoredObjectsCreateUploadOutput,
  StoredObjectsDeleteInput,
  StoredObjectsDeleteOutput,
  StoredObjectsGetInput,
  StoredObjectsGetOutput,
} from "@langwatch/stored-object-contract";
import type {
  StoredObjectDelivery,
  StoredObjectStorage,
  StoredObjectUploadTokenPort,
} from "./stored-object.infrastructure.ts";
import type { StoredObjectRepositories } from "../repositories/stored-object.repositories.ts";
import { StoredObjectService } from "../services/stored-object.service.ts";

/**
 * The contract's byte read, narrowed to the Node stream this process's byte
 * backends hand over: `Readable` is an `AsyncIterable<Uint8Array>`, so the
 * narrower answer still satisfies the contract's `readById`.
 */
export type StoredObjectFileStreamRead =
  | { row: StoredObjectFileRow; stream: Readable }
  | { row: StoredObjectFileRow; status: "missing" };

/**
 * The stored-object reads the byte surface and the probe perform, as the
 * process supplies them. Separate from the portable capability because it is
 * shaped differently rather than merely narrower.
 */
export interface StoredObjectFileReadPort {
  headById(input: Readonly<{ projectId: string; id: string }>): Promise<StoredObjectHead>;
  tryGetById(
    input: Readonly<{ projectId: string; id: string }>,
  ): Promise<StoredObjectFileStreamRead | null>;
}

export type StoredObjectInfrastructure = Readonly<{
  storage: StoredObjectStorage;
  delivery: StoredObjectDelivery;
  uploadTokens: StoredObjectUploadTokenPort;
  idDeriver: StoredObjectIdDeriver;
  maximumUploadBytes: number;
  uploadExpiryMs: number;
  /** The row-and-stream reads the byte surface and the probe perform. */
  files: StoredObjectFileReadPort;
  /** Which project owns an object, when the URL does not say. */
  owners: StoredObjectOwnerResolver;
}>;

type StoredObjectSetup = FeatureSetup<
  Record<never, never>,
  StoredObjectInfrastructure,
  undefined,
  StoredObjectRepositories
>;

export class StoredObjectApp implements StoredObjectApi {
  static readonly contract = StoredObjectApi;
  static readonly dependencies = {};

  static create(setup: StoredObjectSetup): StoredObjectApp {
    return new StoredObjectApp(
      StoredObjectService.create({
        records: setup.repositories.records,
        storage: setup.infrastructure.storage,
        delivery: setup.infrastructure.delivery,
        uploadTokens: setup.infrastructure.uploadTokens,
        idDeriver: setup.infrastructure.idDeriver,
        maximumUploadBytes: setup.infrastructure.maximumUploadBytes,
        uploadExpiryMs: setup.infrastructure.uploadExpiryMs,
      }),
      setup.infrastructure.files,
      setup.infrastructure.owners,
    );
  }

  #storedObjects: StoredObjectService;
  #files: StoredObjectFileReadPort;
  #owners: StoredObjectOwnerResolver;

  private constructor(
    storedObjects: StoredObjectService,
    files: StoredObjectFileReadPort,
    owners: StoredObjectOwnerResolver,
  ) {
    this.#storedObjects = storedObjects;
    this.#files = files;
    this.#owners = owners;
  }

  /** Begins an upload and answers where to put the bytes. */
  createUpload(input: StoredObjectsCreateUploadInput): Promise<StoredObjectsCreateUploadOutput> {
    return this.#storedObjects.createUpload(input);
  }

  /** Completes an upload the caller has finished writing. */
  confirmUpload(input: StoredObjectsConfirmUploadInput): Promise<StoredObjectReference> {
    return this.#storedObjects.confirmUpload(input);
  }

  /** A fresh delivery capability for one object. */
  resolveDelivery(input: StoredObjectsGetInput): Promise<StoredObjectsGetOutput> {
    return this.#storedObjects.resolveDelivery(input);
  }

  /** Removes one object. Idempotent from the caller's side. */
  delete(input: StoredObjectsDeleteInput): Promise<StoredObjectsDeleteOutput> {
    return this.#storedObjects.delete(input);
  }

  /** Whether an object's row AND its bytes exist. */
  headById(input: Readonly<{ projectId: string; id: string }>): Promise<StoredObjectHead> {
    return this.#files.headById(input);
  }

  /** One object's row and, when the bytes are there, a stream of them. */
  readById(
    input: Readonly<{ projectId: string; id: string }>,
  ): Promise<StoredObjectFileStreamRead | null> {
    return this.#files.tryGetById(input);
  }

  /**
   * Which project owns an object, for a URL that does not say. A transient
   * outage on one instance raises rather than answering "no owner": a degraded
   * instance must not read as a deleted object.
   */
  resolveOwner(input: { id: string }): Promise<{ projectId: string } | null> {
    return this.#owners.tryResolve(input);
  }

  storeFromBytes(
    input: StoreStoredObjectFromBytesInput,
  ): Promise<StoreStoredObjectFromBytesResult> {
    return this.#storedObjects.storeFromBytes(input);
  }

  getMetadata(input: { projectId: string; id: string }): Promise<StoredObjectMetadata> {
    return this.#storedObjects.getMetadata(input);
  }

  getById(input: { projectId: string; id: string }): Promise<ReadStoredObjectResult> {
    return this.#storedObjects.getById(input);
  }

  getStorageUsageByProject(input: { projectId: string; purpose?: string }) {
    return this.#storedObjects.getStorageUsageByProject(input);
  }

  deleteOwnedBy(input: { projectId: string }): Promise<DeleteProjectStoredObjectsResult> {
    return this.#storedObjects.deleteOwnedBy(input);
  }
}
