/**
 * The stored-object feature's application. Two shapes of read reach an object
 * and they are not one operation: the portable capability answers metadata and
 * an async iterable, the byte surface needs the ROW. Each has its own name.
 */
import { AuthzApi } from "@langwatch/authz-contract";
import type { FeatureSetup } from "@langwatch/process";
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
  type StoredObjectReadUrl,
  type StoredObjectReadUrlInput,
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
import type { StoredObjectBytesRepository } from "../repositories/stored-object-bytes.repository.ts";
import type { StoredObjectRateLimitRepository } from "../repositories/stored-object-rate-limit.repository.ts";
import type { StoredObjectRepositories } from "../repositories/stored-object.repositories.ts";
import type {
  StoredObjectFileBytes,
  StoredObjectFileReadInput,
  StoredObjectFileStreamRead,
} from "../rules/stored-object-file-access.rules.ts";
import { ImageProxyService } from "../services/image-proxy.service.ts";
import {
  type StoredObjectDelivery,
  UnavailableStoredObjectDeliveryService,
} from "../services/stored-object-delivery.service.ts";
import {
  StoredObjectFileReadService,
  type StoredObjectFileAllowance,
} from "../services/stored-object-file-read.service.ts";
import { StoredObjectOwnerUnresolvedService } from "../services/stored-object-owner-unresolved.service.ts";
import { StoredObjectUploadSignerService } from "../services/stored-object-upload-signer.service.ts";
import { StoredObjectService } from "../services/stored-object.service.ts";
import { StoredObjectsTelemetryService } from "../services/stored-objects-telemetry.service.ts";
import {
  type StoredObjectFileReader,
  StoredObjectsService,
} from "../services/stored-objects.service.ts";
import type { StoredObjectFileApi } from "../transport/stored-object-file.rest.ts";

/** The in-process write ceiling, and the 15-minute pending-upload TTL (ADR-158 §4). */
const MAXIMUM_UPLOAD_BYTES = 100 * 1024 * 1024;
const UPLOAD_EXPIRY_MS = 15 * 60 * 1000;

export type StoredObjectInfrastructure = Readonly<{
  storage: StoredObjectBytesRepository;
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

/** The deployment's public origin, until the shared `publicBaseUrl` config leaf lands. */
type StoredObjectMembers = Readonly<{ publicBaseUrl: string | undefined }>;

type StoredObjectSetup = FeatureSetup<
  StoredObjectDependencies,
  StoredObjectMembers,
  StoredObjectServerConfig,
  StoredObjectRepositories
>;

export class StoredObjectModule implements StoredObjectApi, StoredObjectFileApi {
  static readonly contract = StoredObjectApi;
  static readonly dependencies: StoredObjectDependencies = { authz: AuthzApi };
  static readonly config = storedObjectConfig;
  static readonly reads = ["publicBaseUrl"] as const;

  /**
   * Builds this process's {@link StoredObjectInfrastructure} over its own
   * repositories and config, then composes over it exactly as
   * {@link StoredObjectModule.fromInfrastructure} does.
   */
  static create(setup: StoredObjectSetup): StoredObjectModule {
    const { repositories } = setup;

    return StoredObjectModule.fromInfrastructure({
      infrastructure: {
        storage: repositories.bytes,
        delivery: UnavailableStoredObjectDeliveryService.create(),
        signer: StoredObjectUploadSignerService.create({
          seals: repositories.seals,
          publicBaseUrl: setup.members.publicBaseUrl,
        }),
        maximumUploadBytes: MAXIMUM_UPLOAD_BYTES,
        uploadExpiryMs: UPLOAD_EXPIRY_MS,
        files: StoredObjectsService.create({
          repository: repositories.legacyIndex,
          registry: (projectId) => repositories.legacyStorage.forProject(projectId),
          telemetry: StoredObjectsTelemetryService.create(),
        }),
        owners: StoredObjectOwnerUnresolvedService.create(),
      },
      repositories,
      permissions: setup.dependencies.authz,
      images: HttpExternalImageChannel.create({
        policy: {
          blockLocal: setup.config.blockLocalHttpCalls,
          allowedHosts: setup.config.allowedProxyHosts,
          verifyTls: setup.config.isSaas,
        },
      }),
    });
  }

  /**
   * Composes over an already-built {@link StoredObjectInfrastructure}. Kept
   * because the unit fixture swaps a part (a fixed delivery, a scripted
   * legacy read) that `create` composes as absent.
   */
  static fromInfrastructure(setup: {
    infrastructure: StoredObjectInfrastructure;
    repositories: StoredObjectRepositories;
    permissions: AuthzApi;
    images: ExternalImageChannel;
  }): StoredObjectModule {
    const { infrastructure: parts, repositories } = setup;

    return new StoredObjectModule({
      storage: StoredObjectService.create({
        records: repositories.records,
        storage: parts.storage,
        delivery: parts.delivery,
        signer: parts.signer,
        legacy: parts.files,
        permissions: setup.permissions,
        maximumUploadBytes: parts.maximumUploadBytes,
        uploadExpiryMs: parts.uploadExpiryMs,
      }),
      owners: parts.owners,
      permissions: setup.permissions,
      rateLimits: repositories.rateLimits,
      images: ImageProxyService.create({ images: setup.images }),
    });
  }

  readonly #storage: StoredObjectService;
  readonly #owners: StoredObjectOwnerResolver;
  readonly #permissions: AuthzApi;
  readonly #rateLimits: StoredObjectRateLimitRepository;
  readonly #images: ImageProxyService;
  readonly #files: StoredObjectFileReadService;

  private constructor(parts: {
    storage: StoredObjectService;
    owners: StoredObjectOwnerResolver;
    permissions: AuthzApi;
    rateLimits: StoredObjectRateLimitRepository;
    images: ImageProxyService;
  }) {
    this.#storage = parts.storage;
    this.#owners = parts.owners;
    this.#permissions = parts.permissions;
    this.#rateLimits = parts.rateLimits;
    this.#images = parts.images;
    this.#files = StoredObjectFileReadService.create({
      countRead: (input) => this.countRead(input),
      assertProjectPermission: (input) => this.assertProjectPermission(input),
      isRecorded: (input) => this.#storage.isRecorded(input),
      resolveOwner: (input) => this.resolveOwner(input),
      readById: (input) => this.readById(input),
    });
  }

  /** `GET /api/files/...`: one object's bytes, counted and authorized in the door's order. */
  readFile(input: StoredObjectFileReadInput): Promise<StoredObjectFileBytes> {
    return this.#files.read(input);
  }

  /** `GET /api/image-proxy`: an outside picture fetched behind the egress fence. */
  proxyImage(input: ImageProxyRequest): Promise<Response> {
    return this.#images.proxy(input);
  }

  /** One fixed-window count of the caller's reads, on the module's rate-limit repository. */
  async countRead(input: {
    key: string;
    windowSeconds: number;
    max: number;
  }): Promise<StoredObjectFileAllowance> {
    const decision = await this.#rateLimits.check(input.key, {
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

  /** A signed read URL for a session viewer, held to the object's purpose permission. */
  getReadUrl(
    input: StoredObjectReadUrlInput,
    by: Readonly<{ id: string }>,
  ): Promise<StoredObjectReadUrl> {
    return this.#storage.getReadUrl(input, by);
  }

  /** A signed read URL for a peer that gates its own readers by purpose and owner kind. */
  getReadUrlForPurpose(input: {
    projectId: string;
    id: string;
    purpose: string;
    ownerKind: string;
  }): Promise<StoredObjectReadUrl> {
    return this.#storage.getReadUrlForPurpose(input);
  }

  /** The bytes a signed read URL names. */
  getSignedContent(input: { objectId: string; signature: string }): Promise<StoredObjectFileBytes> {
    return this.#storage.getSignedContent(input);
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
