/**
 * The stored-object feature's application. Two shapes of read reach an object
 * and they are not one operation: the portable capability answers metadata and
 * an async iterable, the byte surface needs the ROW. Each has its own name.
 */
import { AuthzApi } from "@langwatch/authz-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import {
  StoredObjectApi,
  storedObjectConfig,
  type WriteStoredObjectUploadInput,
  type DeleteProjectStoredObjectsResult,
  type ReadStoredObjectResult,
  type StoreStoredObjectFromBytesInput,
  type StoreStoredObjectFromBytesResult,
  type StoredObjectHead,
  type StoredObjectMetadata,
  type StoredObjectOwnerResolver,
  type StoredObjectReference,
  type StoredObjectServerConfig,
  type StoredObjectsConfirmUploadInput,
  type StoredObjectsCreateUploadInput,
  type StoredObjectsCreateUploadOutput,
  type StoredObjectsDeleteInput,
  type StoredObjectsDeleteOutput,
  type StoredObjectsGetInput,
  type StoredObjectsGetOutput,
  type StoredObjectStorageDestination,
  type StoredObjectStorageUsage,
} from "@langwatch/stored-object-contract";

import type { StoredObjectRepositories } from "../repositories/stored-object.repositories.ts";
import type { StoredObjectUploadSignerService } from "../services/stored-object-upload-signer.service.ts";
import {
  StoredObjectService,
  type StoredObjectPermissions,
} from "../services/stored-object.service.ts";
import { buildStoredObjectInfrastructure } from "./stored-object-composition.build.ts";
import type {
  StoredObjectDelivery,
  StoredObjectFileReader,
  StoredObjectFileStreamRead,
  StoredObjectStorage,
} from "./stored-object.members.ts";

export type StoredObjectInfrastructure = Readonly<{
  storage: StoredObjectStorage;
  delivery: StoredObjectDelivery;
  /** Seals the local backend's upload URL (ADR-158 §4). */
  signer: StoredObjectUploadSignerService;
  maximumUploadBytes: number;
  uploadExpiryMs: number;
  /** The legacy ClickHouse index, read when no Postgres row answers (ADR-158 §5). */
  files: StoredObjectFileReader;
  /** Which project owns an object, when the URL does not say. */
  owners: StoredObjectOwnerResolver;
}>;

type StoredObjectDependencies = Readonly<{
  /** Holds a probe to the permission the object's purpose names, once the row is read. */
  authz: typeof AuthzApi;
}>;

type StoredObjectMembers = Pick<
  ProcessMembers,
  "clickhouse" | "logger" | "objectStorage" | "encryption"
> &
  Readonly<{ publicBaseUrl: string | undefined }>;

type StoredObjectSetup = FeatureSetup<
  StoredObjectDependencies,
  StoredObjectMembers,
  StoredObjectServerConfig,
  StoredObjectRepositories
>;

export class StoredObjectApp implements StoredObjectApi {
  static readonly contract = StoredObjectApi;
  static readonly dependencies: StoredObjectDependencies = { authz: AuthzApi };
  static readonly config = storedObjectConfig;
  static readonly reads = [
    "clickhouse",
    "logger",
    "objectStorage",
    "encryption",
    "publicBaseUrl",
  ] as const;

  /**
   * Builds this process's own {@link StoredObjectInfrastructure} from the
   * members it reads and its own config, then composes over it exactly as
   * {@link StoredObjectApp.fromInfrastructure} does.
   */
  static create(setup: StoredObjectSetup): StoredObjectApp {
    const infrastructure = buildStoredObjectInfrastructure({ members: setup.members });

    return StoredObjectApp.fromInfrastructure({
      infrastructure,
      repositories: setup.repositories,
      permissions: setup.dependencies.authz,
    });
  }

  /**
   * Composes over an already-built {@link StoredObjectInfrastructure}. Kept
   * because every unit test's fixture still builds one directly rather than
   * reading process members.
   */
  static fromInfrastructure(setup: {
    infrastructure: StoredObjectInfrastructure;
    repositories: StoredObjectRepositories;
    permissions: StoredObjectPermissions;
  }): StoredObjectApp {
    const { infrastructure: members, repositories } = setup;

    return new StoredObjectApp(
      StoredObjectService.create({
        records: repositories.records,
        storage: members.storage,
        delivery: members.delivery,
        signer: members.signer,
        legacy: members.files,
        permissions: setup.permissions,
        maximumUploadBytes: members.maximumUploadBytes,
        uploadExpiryMs: members.uploadExpiryMs,
      }),
      members.owners,
    );
  }

  #storage: StoredObjectService;
  #owners: StoredObjectOwnerResolver;

  private constructor(storedObjects: StoredObjectService, owners: StoredObjectOwnerResolver) {
    this.#storage = storedObjects;
    this.#owners = owners;
  }

  /** Begins an upload and answers where to put the bytes. */
  createUpload(input: StoredObjectsCreateUploadInput): Promise<StoredObjectsCreateUploadOutput> {
    return this.#storage.createUpload(input);
  }

  /** Completes an upload the caller has finished writing. */
  confirmUpload(input: StoredObjectsConfirmUploadInput): Promise<StoredObjectReference> {
    return this.#storage.confirmUpload(input);
  }

  /** A fresh delivery capability for one object. */
  resolveDelivery(input: StoredObjectsGetInput): Promise<StoredObjectsGetOutput> {
    return this.#storage.resolveDelivery(input);
  }

  /** Removes one object. Idempotent from the caller's side. */
  delete(input: StoredObjectsDeleteInput): Promise<StoredObjectsDeleteOutput> {
    return this.#storage.delete(input);
  }

  /** Streams a local upload to disk once its seal checks out. */
  writeUpload(input: WriteStoredObjectUploadInput): Promise<void> {
    return this.#storage.writeUpload(input);
  }

  /** Whether an object's row AND its bytes exist, held to the permission its purpose names. */
  headById(
    input: Readonly<{ projectId: string; id: string }>,
    by: Readonly<{ id: string }>,
  ): Promise<StoredObjectHead> {
    return this.#storage.headById(input, by);
  }

  /** One object's row and, when the bytes are there, a stream of them. */
  readById(
    input: Readonly<{ projectId: string; id: string }>,
  ): Promise<StoredObjectFileStreamRead | null> {
    return this.#storage.readById(input);
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
    return this.#storage.storeFromBytes(input);
  }

  getMetadata(input: { projectId: string; id: string }): Promise<StoredObjectMetadata> {
    return this.#storage.getMetadata(input);
  }

  getById(input: { projectId: string; id: string }): Promise<ReadStoredObjectResult> {
    return this.#storage.getById(input);
  }

  getStorageUsageByProject(input: {
    projectId: string;
    purpose?: string;
  }): Promise<StoredObjectStorageUsage> {
    return this.#storage.getStorageUsageByProject(input);
  }

  deleteOwnedBy(input: { projectId: string }): Promise<DeleteProjectStoredObjectsResult> {
    return this.#storage.deleteOwnedBy(input);
  }

  getStorageDestination(input: { projectId: string }): Promise<StoredObjectStorageDestination> {
    return this.#storage.getStorageDestination(input);
  }

  probeStorage(input: { projectId: string }): Promise<void> {
    return this.#storage.probeStorage(input);
  }
}
