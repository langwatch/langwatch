import { createHash, randomUUID } from "node:crypto";
import {
  DirectUploadUnavailableError,
  StorageUnavailableError,
  StoredObjectBytesMissingError,
  StoredObjectDeletedError,
  StoredObjectIntegrityConflictError,
  StoredObjectNotFoundError,
  StoredObjectService as StoredObjectServiceContract,
  StoredObjectUnavailableError,
  UploadChecksumMismatchError,
  UploadExpiredError,
  UploadIncompleteError,
  UploadTokenInvalidError,
  UploadTooLargeError,
  type ConfirmStoredObjectUploadInput,
  type CreateStoredObjectUploadInput,
  type DeleteProjectStoredObjectsResult,
  type DeleteStoredObjectInput,
  type ReadStoredObjectResult,
  type StoreStoredObjectFromBytesInput,
  type StoreStoredObjectFromBytesResult,
  type StoredObjectDeliveryAudience,
  type StoredObjectId,
  type StoredObjectIdDeriver,
  type StoredObjectMetadata,
  type StoredObjectReference,
  type StoredObjectStorageUsage,
  type StoredObjectsCreateUploadOutput,
  type StoredObjectsDeleteOutput,
  type StoredObjectsGetOutput,
} from "@langwatch/stored-object-contract";
import {
  StoredObjectDeliveryPort,
  StoredObjectStoragePort,
  StoredObjectUploadTokenPort,
  type StoredObjectStorageAddress,
  type StoredObjectUploadTokenClaims,
} from "../ports/stored-object.port";
import { StoredObjectStore, type StoredObjectRecord } from "../stores/stored-object.store";
import { storedObjectMetadataOf, storedObjectReferenceOf } from "../rules/stored-object-view.rules";
import { StoredObjectUploadService, storageCall } from "./stored-object-upload.service";

export type StoredObjectServiceOptions = Readonly<{
  store: StoredObjectStore;
  storage: StoredObjectStoragePort;
  delivery: StoredObjectDeliveryPort;
  uploadTokens: StoredObjectUploadTokenPort;
  idDeriver: StoredObjectIdDeriver;
  maximumUploadBytes: number;
  uploadExpiryMs: number;
  cleanupBatchSize?: number;
  now?: () => Date;
  operationId?: () => string;
}>;

/** The feature's only lifecycle/orchestration class. */
export class StoredObjectService extends StoredObjectServiceContract {
  static create(options: StoredObjectServiceOptions): StoredObjectService {
    if (!Number.isSafeInteger(options.maximumUploadBytes) || options.maximumUploadBytes < 0) {
      throw new RangeError("maximumUploadBytes must be a non-negative safe integer");
    }

    if (!Number.isSafeInteger(options.uploadExpiryMs) || options.uploadExpiryMs <= 0) {
      throw new RangeError("uploadExpiryMs must be a positive safe integer");
    }

    return new StoredObjectService(options);
  }

  private readonly now: () => Date;
  private readonly operationId: () => string;
  private readonly uploads: StoredObjectUploadService;

  private constructor(private readonly options: StoredObjectServiceOptions) {
    super();
    this.now = options.now ?? (() => new Date());
    this.operationId = options.operationId ?? (() => `upload_${randomUUID()}`);
    this.uploads = StoredObjectUploadService.create({
      ...options,
      now: this.now,
      operationId: this.operationId,
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

  async getMetadata(input: { projectId: string; id: string }): Promise<StoredObjectMetadata> {
    return storedObjectMetadataOf(await this.getAvailable(input));
  }

  async getById(input: { projectId: string; id: string }): Promise<ReadStoredObjectResult> {
    const value = await this.getAvailable(input);
    const address = this.getStorage(value);
    const bytes = await storageCall(() =>
      this.options.storage.tryRead({ projectId: input.projectId, address }),
    );
    if (!bytes) {
      throw new StoredObjectBytesMissingError(input.projectId, input.id);
    }

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
        deletedAt: value.deletedAt.toISOString(),
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
    await this.options.store.save(deleted);
    if (deleted.storage) {
      const cleaned = await this.deleteStorageBestEffort({
        projectId: input.projectId,
        address: deleted.storage,
      });
      if (cleaned) {
        await this.options.store.save({ ...deleted, storage: null });
      }
    }

    return {
      id: deleted.id,
      generation: deleted.generation,
      deletedAt: deletedAt.toISOString(),
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

    const usage = await this.options.store.getUsage(query);
    const result: StoredObjectStorageUsage = {
      projectId: input.projectId,
      ...usage,
    };
    if (input.purpose) {
      result.purpose = input.purpose;
    }

    return result;
  }

  async deleteOwnedBy(input: { projectId: string }): Promise<DeleteProjectStoredObjectsResult> {
    let afterId: StoredObjectId | undefined;
    let deletedObjectCount = 0;
    let deletedByteLength = 0;
    const limit = this.options.cleanupBatchSize ?? 100;
    for (;;) {
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

      const page = await this.options.store.findPage(query);
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

      if (page.length < limit) {
        break;
      }

      afterId = page.at(-1)?.id;
      if (!afterId) {
        break;
      }
    }

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
    const page = await this.options.store.findPage({
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

      await this.options.store.save({
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
    const page = await this.options.store.findPage({
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

      await this.options.store.save({
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
    const value = await this.options.store.tryFind({
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
