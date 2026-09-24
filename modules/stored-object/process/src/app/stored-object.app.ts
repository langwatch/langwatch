/**
 * The stored-object feature's application. Two shapes of read reach an object
 * and they are not one operation: the portable capability answers metadata and
 * an async iterable, the byte surface needs the ROW. Each has its own name.
 */
import type { Readable } from "node:stream";

import { browserCallerOfRequest } from "@langwatch/api/rest";
import { AuthzApi } from "@langwatch/authz-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import type { ProcessMembers, RateLimiter } from "@langwatch/process-stores/members";
import { StoredObjectApi, storedObjectConfig } from "@langwatch/stored-object-contract";
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
  StoredObjectServerConfig,
  StoredObjectsConfirmUploadInput,
  StoredObjectsCreateUploadInput,
  StoredObjectsCreateUploadOutput,
  StoredObjectsDeleteInput,
  StoredObjectsDeleteOutput,
  StoredObjectsGetInput,
  StoredObjectsGetOutput,
  StoredObjectStorageDestination,
  StoredObjectStorageUsage,
} from "@langwatch/stored-object-contract";
import { nowInstant } from "@langwatch/time";

import type { StoredObjectRepositories } from "../repositories/stored-object.repositories.ts";
import { StoredObjectService } from "../services/stored-object.service.ts";
import type {
  StoredObjectFileAllowance,
  StoredObjectFileApi,
  StoredObjectFileCaller,
  StoredObjectFileViewPermission,
} from "../transport/stored-object-file.rest.ts";
import { buildStoredObjectInfrastructure } from "./stored-object-composition.build.ts";
import type {
  StoredObjectDelivery,
  StoredObjectStorage,
  StoredObjectUploadTokenCodec,
} from "./stored-object.members.ts";

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
export interface StoredObjectFileReader {
  headById(input: Readonly<{ projectId: string; id: string }>): Promise<StoredObjectHead>;
  /** Throws `StoredObjectNotFoundError` when the project holds no such row. */
  getById(input: Readonly<{ projectId: string; id: string }>): Promise<StoredObjectFileStreamRead>;
}

export type StoredObjectInfrastructure = Readonly<{
  storage: StoredObjectStorage;
  delivery: StoredObjectDelivery;
  uploadTokens: StoredObjectUploadTokenCodec;
  idDeriver: StoredObjectIdDeriver;
  maximumUploadBytes: number;
  uploadExpiryMs: number;
  /** The row-and-stream reads the byte surface and the probe perform. */
  files: StoredObjectFileReader;
  /** Which project owns an object, when the URL does not say. */
  owners: StoredObjectOwnerResolver;
}>;

/** The person's project permission the byte door asks, answered by its owner. */
type StoredObjectDependencies = Readonly<{ permissions: typeof AuthzApi }>;

/** `nodeEnvironment` is the process's own fact (§6), for the Azure insecure-token-endpoint gate. */
type StoredObjectMembers = Pick<
  ProcessMembers,
  "prisma" | "clickhouse" | "logger" | "secrets" | "rateLimiter"
> &
  Readonly<{ nodeEnvironment: string | undefined }>;

type StoredObjectSetup = FeatureSetup<
  StoredObjectDependencies,
  StoredObjectMembers,
  StoredObjectServerConfig,
  StoredObjectRepositories
>;

export class StoredObjectApp implements StoredObjectApi, StoredObjectFileApi {
  static readonly contract = StoredObjectApi;
  static readonly dependencies = { permissions: AuthzApi };
  static readonly config = storedObjectConfig;
  /** Both names are from the process's vocabulary; boot refuses by name. */
  static readonly reads = [
    "prisma",
    "clickhouse",
    "logger",
    "secrets",
    "rateLimiter",
    "nodeEnvironment",
  ] as const;

  /**
   * Builds this process's own {@link StoredObjectInfrastructure} from the
   * members it reads and its own config, then composes over it exactly as
   * {@link StoredObjectApp.fromInfrastructure} does.
   */
  static create(setup: StoredObjectSetup): StoredObjectApp {
    const infrastructure = buildStoredObjectInfrastructure({
      members: setup.members,
      config: setup.config,
      resources: setup.resources,
    });

    return StoredObjectApp.fromInfrastructure({
      infrastructure,
      repositories: setup.repositories,
      permissions: setup.dependencies.permissions,
      rateLimiter: setup.members.rateLimiter,
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
    permissions: AuthzApi;
    rateLimiter: RateLimiter;
  }): StoredObjectApp {
    const { infrastructure: members, repositories } = setup;

    return new StoredObjectApp({
      storage: StoredObjectService.create({
        records: repositories.records,
        storage: members.storage,
        delivery: members.delivery,
        uploadTokens: members.uploadTokens,
        idDeriver: members.idDeriver,
        maximumUploadBytes: members.maximumUploadBytes,
        uploadExpiryMs: members.uploadExpiryMs,
      }),
      files: members.files,
      owners: members.owners,
      permissions: setup.permissions,
      rateLimiter: setup.rateLimiter,
    });
  }

  readonly #storage: StoredObjectService;
  readonly #files: StoredObjectFileReader;
  readonly #owners: StoredObjectOwnerResolver;
  readonly #permissions: AuthzApi;
  readonly #rateLimiter: RateLimiter;

  private constructor(parts: {
    storage: StoredObjectService;
    files: StoredObjectFileReader;
    owners: StoredObjectOwnerResolver;
    permissions: AuthzApi;
    rateLimiter: RateLimiter;
  }) {
    this.#storage = parts.storage;
    this.#files = parts.files;
    this.#owners = parts.owners;
    this.#permissions = parts.permissions;
    this.#rateLimiter = parts.rateLimiter;
  }

  /** Who the process's own browser verifier admitted on this request, before the handler ran. */
  async identify({ request }: { request: Request }): Promise<StoredObjectFileCaller> {
    const userId = browserCallerOfRequest(request)?.userId;

    return userId ? { userId } : {};
  }

  /** One fixed-window count of the caller's reads, on the process's own limiter. */
  async countRead(input: {
    key: string;
    windowSeconds: number;
    max: number;
  }): Promise<StoredObjectFileAllowance> {
    const decision = await this.#rateLimiter.check(input.key, {
      requests: input.max,
      seconds: input.windowSeconds,
    });
    const retryAfterSeconds = decision.retryAfterSeconds ?? input.windowSeconds;

    return {
      allowed: decision.allowed,
      resetAt: nowInstant().epochMilliseconds + retryAfterSeconds * 1000,
    };
  }

  /** Refuses with the authz module's own denial unless the person holds the permission. */
  assertProjectPermission(input: {
    userId: string;
    projectId: string;
    permission: StoredObjectFileViewPermission;
  }): Promise<void> {
    return this.#permissions.authorizeProjectPermission(input);
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

  /** Whether an object's row AND its bytes exist. */
  headById(input: Readonly<{ projectId: string; id: string }>): Promise<StoredObjectHead> {
    return this.#files.headById(input);
  }

  /** One object's row and, when the bytes are there, a stream of them. */
  readById(
    input: Readonly<{ projectId: string; id: string }>,
  ): Promise<StoredObjectFileStreamRead> {
    return this.#files.getById(input);
  }

  /**
   * Which project owns an object, for a URL that does not say. A transient
   * outage on one instance raises rather than answering "no owner": a degraded
   * instance must not read as a deleted object.
   */
  resolveOwner(input: { id: string }): Promise<{ projectId: string }> {
    return this.#owners.getOwner(input);
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
