import { Readable } from "node:stream";

import { PermissionDeniedError, type AuthzApi } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import {
  StoredObjectBytesMissingError,
  StoredObjectDeletedError,
  StoredObjectNotFoundError,
  StoredObjectUnavailableError,
  type ConfirmStoredObjectUploadInput,
  type CreateStoredObjectUploadInput,
  type DeleteProjectStoredObjectsResult,
  type DeleteStoredObjectInput,
  type ReadStoredObjectResult,
  type StoreStoredObjectFromBytesInput,
  type StoreStoredObjectFromBytesResult,
  type StoredObjectDeliveryAudience,
  type StoredObjectHead,
  type StoredObjectId,
  type StoredObjectMetadata,
  type StoredObjectReference,
  type StoredObjectStorageDestination,
  type StoredObjectStorageUsage,
  type StoredObjectsCreateUploadOutput,
  type StoredObjectsDeleteOutput,
  type StoredObjectsGetOutput,
  type WriteStoredObjectUploadInput,
} from "@langwatch/stored-object-contract";
import { type Instant, nowInstant, toDate } from "@langwatch/time";

import type {
  StoredObjectDelivery,
  StoredObjectFileReader,
  StoredObjectFileStreamRead,
  StoredObjectProbe,
  StoredObjectStorage,
  StoredObjectStorageAddress,
} from "../app/stored-object.members.ts";
import type {
  StoredObjectRecord,
  StoredObjectRecordRepository,
} from "../repositories/stored-object-record.repository.ts";
import { requiredPermissionForPurpose } from "../rules/stored-object-purpose-permission.rules.ts";
import { storedObjectMetadataOf } from "../rules/stored-object-view.rules.ts";
import type { StoredObjectUploadSignerService } from "./stored-object-upload-signer.service.ts";
import { StoredObjectUploadService } from "./stored-object-upload.service.ts";

/** The peer decision a probe asks once the row names its purpose. */
export type StoredObjectPermissions = Pick<AuthzApi, "getDecision">;

export type StoredObjectServiceOptions = Readonly<{
  records: StoredObjectRecordRepository;
  permissions: StoredObjectPermissions;
  storage: StoredObjectStorage;
  delivery: StoredObjectDelivery;
  signer: StoredObjectUploadSignerService;
  /** The legacy ClickHouse index, read only where no Postgres row answers (ADR-158 §5). */
  legacy: StoredObjectFileReader;
  maximumUploadBytes: number;
  uploadExpiryMs: number;
  cleanupBatchSize?: number;
  now?: () => Instant;
  newId?: () => string;
}>;

/** Every stored object's id is a fresh KSUID of this resource (ADR-158 §3). */
const STORED_OBJECT_KSUID_RESOURCE = "so";

/** The feature's only lifecycle/orchestration class. */
export class StoredObjectService {
  static create(options: StoredObjectServiceOptions): StoredObjectService {
    if (!Number.isSafeInteger(options.maximumUploadBytes) || options.maximumUploadBytes < 0) {
      throw new RangeError("maximumUploadBytes must be a non-negative safe integer");
    }

    if (!Number.isSafeInteger(options.uploadExpiryMs) || options.uploadExpiryMs <= 0) {
      throw new RangeError("uploadExpiryMs must be a positive safe integer");
    }

    return new StoredObjectService(options);
  }

  private readonly now: () => Instant;
  private readonly uploads: StoredObjectUploadService;

  private constructor(private readonly options: StoredObjectServiceOptions) {
    this.now = options.now ?? nowInstant;
    this.uploads = StoredObjectUploadService.create({
      records: options.records,
      storage: options.storage,
      signer: options.signer,
      maximumUploadBytes: options.maximumUploadBytes,
      uploadExpiryMs: options.uploadExpiryMs,
      now: this.now,
      newId: options.newId ?? (() => generate(STORED_OBJECT_KSUID_RESOURCE).toString()),
    });
  }

  async storeFromBytes(
    input: StoreStoredObjectFromBytesInput,
  ): Promise<StoreStoredObjectFromBytesResult> {
    return this.uploads.storeFromBytes(input);
  }

  async createUpload(
    input: CreateStoredObjectUploadInput,
  ): Promise<StoredObjectsCreateUploadOutput> {
    return this.uploads.createUpload(input);
  }

  async confirmUpload(input: ConfirmStoredObjectUploadInput): Promise<StoredObjectReference> {
    return this.uploads.confirmUpload(input);
  }

  async writeUpload(input: WriteStoredObjectUploadInput): Promise<void> {
    return this.uploads.writeUpload(input);
  }

  /**
   * Main's post-read gate: the transport admitted any file viewer, and the
   * row's purpose now names the one permission this probe needs.
   */
  async headById(
    input: { projectId: string; id: string },
    by: Readonly<{ id: string }>,
  ): Promise<StoredObjectHead> {
    const probe = await this.probe(input);
    if (probe.status === "not_found") return probe;

    const permission = requiredPermissionForPurpose(probe.purpose);
    const decision = await this.options.permissions.getDecision({
      userId: by.id,
      permission,
      scope: { tier: "project", id: input.projectId },
    });
    if (!decision.permitted) {
      throw new PermissionDeniedError({
        permission,
        scope: { type: "project", id: input.projectId },
        denialReason: decision.denialReason ?? "no-binding",
      });
    }

    return { status: probe.status, mediaType: probe.mediaType };
  }

  /** Postgres first; the legacy index answers only for an object it never held. */
  private async probe(input: { projectId: string; id: string }): Promise<StoredObjectProbe> {
    const value = await this.options.records.findById({ tenantId: input.projectId, id: input.id });
    if (!value) return this.options.legacy.headById(input);
    if (value.status !== "available") return { status: "not_found" };

    const facts = { mediaType: value.mediaType, purpose: value.purpose };
    if (!value.storage) return { status: "missing", ...facts };

    try {
      const bytes = await StoredObjectUploadService.storageCall(() =>
        this.options.storage.getBytes({
          projectId: input.projectId,
          address: this.getStorage(value),
        }),
      );
      await bytes[Symbol.asyncIterator]().return?.();
    } catch (error) {
      if (error instanceof HandledError && error.code === "stored_object_not_found") {
        return { status: "missing", ...facts };
      }
      throw error;
    }

    return { status: "available", ...facts };
  }

  /**
   * The row and its bytes for the file route: Postgres first, then the legacy
   * index. Throws `StoredObjectNotFoundError` when neither holds an available row.
   */
  async readById(input: { projectId: string; id: string }): Promise<StoredObjectFileStreamRead> {
    const value = await this.options.records.findById({ tenantId: input.projectId, id: input.id });
    if (!value) return this.options.legacy.getById(input);
    if (value.status !== "available") throw new StoredObjectNotFoundError();

    const row = {
      id: value.id,
      purpose: value.purpose,
      owner_kind: value.ownerKind,
      media_type: value.mediaType,
      size_bytes: value.byteLength,
    };
    if (!value.storage) return { row, status: "missing" };

    try {
      const bytes = await this.options.storage.getBytes({
        projectId: input.projectId,
        address: value.storage,
      });
      return { row, stream: Readable.from(bytes) };
    } catch (error) {
      if (error instanceof HandledError && error.code === "stored_object_not_found") {
        return { row, status: "missing" };
      }
      throw error;
    }
  }

  async getMetadata(input: { projectId: string; id: string }): Promise<StoredObjectMetadata> {
    return storedObjectMetadataOf(await this.getAvailable(input));
  }

  async getById(input: { projectId: string; id: string }): Promise<ReadStoredObjectResult> {
    const value = await this.getAvailable(input);
    const address = this.getStorage(value);
    const bytes = await StoredObjectUploadService.storageCall(() =>
      this.options.storage.getBytes({ projectId: input.projectId, address }),
    ).catch((error: unknown) => {
      if (error instanceof HandledError && error.code === "stored_object_not_found") {
        throw new StoredObjectBytesMissingError(input.projectId, input.id);
      }
      throw error;
    });

    return { metadata: storedObjectMetadataOf(value), bytes };
  }

  async resolveDelivery(input: {
    projectId: string;
    id: string;
    audience: StoredObjectDeliveryAudience;
  }): Promise<StoredObjectsGetOutput> {
    const value = await this.getAvailable(input);
    if (!value.audiences.includes(input.audience)) {
      throw new StoredObjectNotFoundError();
    }

    return {
      metadata: storedObjectMetadataOf(value),
      capability: await this.options.delivery.mint({
        ...input,
        generation: value.generation,
      }),
    };
  }

  async streamForDelivery(input: {
    projectId: string;
    id: string;
    audience: StoredObjectDeliveryAudience;
    generation: number;
    method: "GET" | "HEAD";
  }): Promise<ReadStoredObjectResult> {
    const value = await this.getAvailable(input);
    if (value.generation !== input.generation || !value.audiences.includes(input.audience)) {
      throw new StoredObjectNotFoundError();
    }

    return this.getById(input);
  }

  async delete(input: DeleteStoredObjectInput): Promise<StoredObjectsDeleteOutput> {
    const value = await this.getStoredObject(input);
    if (value.status === "deleted" && value.deletedAt) {
      return {
        id: value.id,
        generation: value.generation,
        deletedAt: toDate(value.deletedAt).toISOString(),
      };
    }

    const deletedAt = this.now();
    const deleted = {
      ...value,
      status: "deleted" as const,
      generation: value.generation + 1,
      deletedAt,
      updatedAt: deletedAt,
    };
    await this.options.records.upsert(deleted);
    if (deleted.storage) {
      const cleaned = await this.deleteStorageBestEffort({
        projectId: input.projectId,
        address: deleted.storage,
      });
      if (cleaned) {
        await this.options.records.upsert({ ...deleted, storage: null });
      }
    }

    return {
      id: deleted.id,
      generation: deleted.generation,
      deletedAt: toDate(deletedAt).toISOString(),
    };
  }

  async getStorageUsageByProject(input: {
    projectId: string;
    purpose?: string;
  }): Promise<StoredObjectStorageUsage> {
    const query: { tenantId: string; purpose?: string } = {
      tenantId: input.projectId,
    };
    if (input.purpose) {
      query.purpose = input.purpose;
    }

    const usage = await this.options.records.countActive(query);
    const result: StoredObjectStorageUsage = {
      projectId: input.projectId,
      ...usage,
    };
    if (input.purpose) {
      result.purpose = input.purpose;
    }

    return result;
  }

  getStorageDestination(input: { projectId: string }): Promise<StoredObjectStorageDestination> {
    return this.options.storage.resolveDestination(input);
  }

  probeStorage(input: { projectId: string }): Promise<void> {
    return this.options.storage.probe(input);
  }

  async deleteOwnedBy(input: { projectId: string }): Promise<DeleteProjectStoredObjectsResult> {
    let afterId: StoredObjectId | undefined;
    let deletedObjectCount = 0;
    let deletedByteLength = 0;
    const limit = this.options.cleanupBatchSize ?? 100;
    let isFullPage: boolean;
    do {
      const query: {
        tenantId: string;
        afterId?: StoredObjectId;
        limit: number;
      } = {
        tenantId: input.projectId,
        limit,
      };
      if (afterId) {
        query.afterId = afterId;
      }

      const page = await this.options.records.findPage(query);
      for (const value of page) {
        if (value.status !== "deleted") {
          await this.delete({
            projectId: input.projectId,
            id: value.id,
            idempotencyKey: `project-delete:${input.projectId}:${value.id}`,
          });
          deletedObjectCount += 1;
          deletedByteLength += value.byteLength;
        }
      }

      isFullPage = page.length >= limit;
      afterId = page.at(-1)?.id;
    } while (isFullPage && afterId);

    return {
      projectId: input.projectId,
      deletedObjectCount,
      deletedByteLength,
      status: "completed",
    };
  }

  /** Bounded retry for pending uploads that have expired. */
  async cleanupExpiredUploads(input: { projectId: string; limit?: number }): Promise<number> {
    const now = this.now();
    const page = await this.options.records.findPage({
      tenantId: input.projectId,
      status: "pending",
      expiresBefore: now,
      limit: input.limit ?? this.options.cleanupBatchSize ?? 100,
    });
    let cleaned = 0;
    for (const value of page) {
      if (
        value.storage &&
        !(await this.deleteStorageBestEffort({
          projectId: input.projectId,
          address: value.storage,
        }))
      ) {
        continue;
      }

      await this.options.records.upsert({
        ...value,
        status: "failed",
        storage: null,
        updatedAt: now,
      });
      cleaned += 1;
    }

    return cleaned;
  }

  /** Bounded retry for provider deletion after logical deletion won. */
  async cleanupDeletedObjects(input: { projectId: string; limit?: number }): Promise<number> {
    const now = this.now();
    const page = await this.options.records.findPage({
      tenantId: input.projectId,
      status: "deleted",
      limit: input.limit ?? this.options.cleanupBatchSize ?? 100,
    });
    let cleaned = 0;
    for (const value of page) {
      if (!value.storage) {
        continue;
      }

      if (
        !(await this.deleteStorageBestEffort({
          projectId: input.projectId,
          address: value.storage,
        }))
      ) {
        continue;
      }

      await this.options.records.upsert({
        ...value,
        storage: null,
        updatedAt: now,
      });
      cleaned += 1;
    }

    return cleaned;
  }

  private async getAvailable(input: {
    projectId: string;
    id: string;
  }): Promise<StoredObjectRecord> {
    const value = await this.getStoredObject(input);
    if (value.status === "deleted") {
      throw new StoredObjectDeletedError(input.projectId, input.id);
    }

    if (value.status !== "available") {
      throw new StoredObjectUnavailableError(input.projectId, input.id);
    }

    return value;
  }

  private async getStoredObject(input: {
    projectId: string;
    id: string;
  }): Promise<StoredObjectRecord> {
    const value = await this.options.records.findById({
      tenantId: input.projectId,
      id: input.id,
    });
    if (!value) {
      throw new StoredObjectNotFoundError();
    }

    return value;
  }

  private getStorage(value: StoredObjectRecord): StoredObjectStorageAddress {
    if (!value.storage) {
      throw new StoredObjectBytesMissingError(value.tenantId, value.id);
    }

    return value.storage;
  }

  private async deleteStorageBestEffort(input: {
    projectId: string;
    address: StoredObjectStorageAddress;
  }): Promise<boolean> {
    try {
      await this.options.storage.delete(input);

      return true;
    } catch {
      return false;
    }
  }
}
