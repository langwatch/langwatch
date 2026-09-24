/**
 * The stored-object feature's application. Two shapes of read reach an object
 * and they are not one operation: the portable capability answers metadata and
 * an async iterable, the byte surface needs the ROW. Each has its own name.
 */
import { browserCallerOfRequest } from "@langwatch/api/rest";
import { AuthzApi } from "@langwatch/authz-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import type { ProcessMembers, RateLimiter } from "@langwatch/process-stores/members";
import {
  StoredObjectApi,
  storedObjectConfig,
  type WriteStoredObjectUploadInput,
  type DeleteProjectStoredObjectsResult,
  type ImageProxyRequest,
  type ReadStoredObjectResult,
  type StoreStoredObjectFromBytesInput,
  type StoreStoredObjectFromBytesResult,
  type StoredObjectFileViewPermission,
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
import { nowInstant } from "@langwatch/time";

import type { ExternalImageChannel } from "../channels/external-image.channel.ts";
import { HttpExternalImageChannel } from "../channels/http/http.external-image.channel.ts";
import type { StoredObjectRepositories } from "../repositories/stored-object.repositories.ts";
import { ImageProxyService } from "../services/image-proxy.service.ts";
import type { StoredObjectUploadSignerService } from "../services/stored-object-upload-signer.service.ts";
import { StoredObjectService } from "../services/stored-object.service.ts";
import type {
  StoredObjectFileAllowance,
  StoredObjectFileApi,
  StoredObjectFileCaller,
} from "../transport/stored-object-file.rest.ts";
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
  "clickhouse" | "logger" | "objectStorage" | "encryption" | "rateLimiter"
> &
  Readonly<{ publicBaseUrl: string | undefined; isSaas: boolean }>;

type StoredObjectSetup = FeatureSetup<
  StoredObjectDependencies,
  StoredObjectMembers,
  StoredObjectServerConfig,
  StoredObjectRepositories
>;

export class StoredObjectApp implements StoredObjectApi, StoredObjectFileApi {
  static readonly contract = StoredObjectApi;
  static readonly dependencies: StoredObjectDependencies = { authz: AuthzApi };
  static readonly config = storedObjectConfig;
  static readonly reads = [
    "clickhouse",
    "logger",
    "objectStorage",
    "encryption",
    "rateLimiter",
    "publicBaseUrl",
    "isSaas",
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
      rateLimiter: setup.members.rateLimiter,
      images: HttpExternalImageChannel.create({
        policy: {
          blockLocal: setup.config.blockLocalHttpCalls,
          allowedHosts: setup.config.allowedProxyHosts,
          verifyTls: setup.members.isSaas,
        },
      }),
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
    images: ExternalImageChannel;
  }): StoredObjectApp {
    const { infrastructure: members, repositories } = setup;

    return new StoredObjectApp({
      storage: StoredObjectService.create({
        records: repositories.records,
        storage: members.storage,
        delivery: members.delivery,
        signer: members.signer,
        legacy: members.files,
        permissions: setup.permissions,
        maximumUploadBytes: members.maximumUploadBytes,
        uploadExpiryMs: members.uploadExpiryMs,
      }),
      owners: members.owners,
      permissions: setup.permissions,
      rateLimiter: setup.rateLimiter,
      images: ImageProxyService.create({ images: setup.images }),
    });
  }

  readonly #storage: StoredObjectService;
  readonly #owners: StoredObjectOwnerResolver;
  readonly #permissions: AuthzApi;
  readonly #rateLimiter: RateLimiter;
  readonly #images: ImageProxyService;

  private constructor(parts: {
    storage: StoredObjectService;
    owners: StoredObjectOwnerResolver;
    permissions: AuthzApi;
    rateLimiter: RateLimiter;
    images: ImageProxyService;
  }) {
    this.#storage = parts.storage;
    this.#owners = parts.owners;
    this.#permissions = parts.permissions;
    this.#rateLimiter = parts.rateLimiter;
    this.#images = parts.images;
  }

  /** `GET /api/image-proxy`: an outside picture fetched behind the egress fence. */
  proxyImage(input: ImageProxyRequest): Promise<Response> {
    return this.#images.proxy(input);
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
  ): Promise<StoredObjectFileStreamRead> {
    return this.#storage.readById(input);
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
