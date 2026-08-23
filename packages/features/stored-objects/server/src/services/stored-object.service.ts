import { createHash, randomUUID } from "node:crypto";
import {
  DirectUploadUnavailableError,
  StorageUnavailableError,
  StoredObjectBytesMissingError,
  StoredObjectDeletedError,
  StoredObjectIntegrityConflictError,
  StoredObjectNotFoundError,
  StoredObjectsService as StoredObjectsServiceContract,
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
} from "@langwatch/stored-objects-contract";
import {
  StoredObjectDeliveryPort,
  StoredObjectStoragePort,
  StoredObjectUploadTokenPort,
  type StoredObjectStorageAddress,
} from "../ports/stored-object.port";
import {
  StoredObjectStore,
  type StoredObjectRecord,
} from "../stores/stored-object.store";

export type StoredObjectsServiceOptions = Readonly<{
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
export class StoredObjectsService extends StoredObjectsServiceContract {
  static create(options: StoredObjectsServiceOptions): StoredObjectsService {
    if (
      !Number.isSafeInteger(options.maximumUploadBytes) ||
      options.maximumUploadBytes < 0
    ) {
      throw new RangeError(
        "maximumUploadBytes must be a non-negative safe integer",
      );
    }
    if (
      !Number.isSafeInteger(options.uploadExpiryMs) ||
      options.uploadExpiryMs <= 0
    ) {
      throw new RangeError("uploadExpiryMs must be a positive safe integer");
    }
    return new StoredObjectsService(options);
  }

  private readonly now: () => Date;
  private readonly operationId: () => string;

  private constructor(private readonly options: StoredObjectsServiceOptions) {
    super();
    this.now = options.now ?? (() => new Date());
    this.operationId = options.operationId ?? (() => `upload_${randomUUID()}`);
  }

  async storeFromBytes(
    input: StoreStoredObjectFromBytesInput,
  ): Promise<StoreStoredObjectFromBytesResult> {
    const bytes = await this.readBounded(input.bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const id = await this.options.idDeriver.fromDigest({
      projectId: input.projectId,
      sha256,
    });
    const existing = await this.options.store.find({
      tenantId: input.projectId,
      id,
    });
    if (existing?.status === "available") {
      this.assertByteFacts(existing, bytes.byteLength);
      if (!existing.audiences.includes(input.audience)) {
        await this.options.store.save({
          ...existing,
          audiences: [...existing.audiences, input.audience],
          updatedAt: this.now(),
        });
      }
      return { reference: this.reference(existing), isDuplicate: true };
    }

    const address = await this.storageCall(() =>
      this.options.storage.write({
        projectId: input.projectId,
        objectId: id,
        bytes,
        mediaType: input.mediaType,
      }),
    );
    const now = this.now();
    const record: StoredObjectRecord = {
      tenantId: input.projectId,
      id,
      status: "available",
      purpose: input.purpose,
      ownerKind: input.ownerKind,
      ownerId: input.ownerId,
      filename: input.filename,
      sha256,
      byteLength: bytes.byteLength,
      mediaType: input.mediaType,
      mediaTypeVerified: true,
      storage: address,
      generation: (existing?.generation ?? 0) + 1,
      audiences: [input.audience],
      expiresAt: null,
      availableAt: now,
      deletedAt: null,
      source: "canonical",
      legacyFingerprint: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      await this.options.store.save(record);
    } catch (error) {
      await this.ignoreStorageFailure(() =>
        this.options.storage.delete({ projectId: input.projectId, address }),
      );
      throw error;
    }
    return { reference: this.reference(record), isDuplicate: false };
  }

  async createUpload(
    input: CreateStoredObjectUploadInput,
  ): Promise<StoredObjectsCreateUploadOutput> {
    if (input.byteLength > this.options.maximumUploadBytes) {
      throw new UploadTooLargeError(
        input.byteLength,
        this.options.maximumUploadBytes,
      );
    }
    const id = await this.options.idDeriver.fromDigest({
      projectId: input.projectId,
      sha256: input.sha256,
    });
    const existing = await this.options.store.find({
      tenantId: input.projectId,
      id,
    });
    if (existing?.status === "available") {
      this.assertByteFacts(existing, input.byteLength);
      return { status: "existing", reference: this.reference(existing) };
    }

    const operationId = this.operationId();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.options.uploadExpiryMs);
    const upload = await this.storageCall(() =>
      this.options.storage.createUpload({
        projectId: input.projectId,
        objectId: id,
        byteLength: input.byteLength,
        sha256: input.sha256,
        mediaType: input.mediaType,
        expiresAt,
      }),
    );
    if (!upload) throw new DirectUploadUnavailableError();

    const record: StoredObjectRecord = {
      tenantId: input.projectId,
      id,
      status: "pending",
      purpose: "public_upload",
      ownerKind: "project",
      ownerId: input.projectId,
      filename: input.filename,
      sha256: input.sha256,
      byteLength: input.byteLength,
      mediaType: input.mediaType,
      mediaTypeVerified: false,
      storage: upload.address,
      generation: existing?.generation ?? 0,
      audiences: ["project:view"],
      expiresAt,
      availableAt: null,
      deletedAt: null,
      source: "canonical",
      legacyFingerprint: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      await this.options.store.save(record);
    } catch (error) {
      await this.ignoreStorageFailure(() =>
        this.options.storage.delete({
          projectId: input.projectId,
          address: upload.address,
        }),
      );
      throw error;
    }
    const reference = this.reference(record);
    const uploadToken = await this.options.uploadTokens.encode({
      projectId: input.projectId,
      objectId: id,
      operationId,
      address: upload.address,
      reference,
      expiresAt: expiresAt.toISOString(),
    });
    return {
      status: "pending",
      objectId: id,
      operationId,
      uploadToken,
      upload: upload.target,
    };
  }

  async confirmUpload(
    input: ConfirmStoredObjectUploadInput,
  ): Promise<StoredObjectReference> {
    const claims = await this.decodeUploadToken(input.uploadToken);
    if (claims.projectId !== input.projectId) {
      throw new UploadTokenInvalidError();
    }
    const value = await this.options.store.find({
      tenantId: claims.projectId,
      id: claims.objectId,
    });
    if (!value || value.status !== "pending") {
      if (value?.status === "available") return this.reference(value);
      throw new UploadIncompleteError(claims.operationId);
    }
    if (
      value.expiresAt === null ||
      value.expiresAt.getTime() <= this.now().getTime()
    ) {
      throw new UploadExpiredError(claims.operationId);
    }
    const stat = await this.storageCall(() =>
      this.options.storage.stat({
        projectId: claims.projectId,
        address: claims.address,
      }),
    );
    if (!stat) throw new UploadIncompleteError(claims.operationId);
    if (stat.byteLength !== value.byteLength || stat.sha256 !== value.sha256) {
      throw new UploadChecksumMismatchError(claims.operationId);
    }
    const now = this.now();
    const available: StoredObjectRecord = {
      ...value,
      status: "available",
      mediaTypeVerified: true,
      storage: claims.address,
      generation: value.generation + 1,
      expiresAt: null,
      availableAt: now,
      updatedAt: now,
    };
    await this.options.store.save(available);
    return this.reference(available);
  }

  async getMetadata(input: {
    projectId: string;
    id: string;
  }): Promise<StoredObjectMetadata> {
    return this.metadata(await this.requireAvailable(input));
  }

  async getById(input: {
    projectId: string;
    id: string;
  }): Promise<ReadStoredObjectResult> {
    const value = await this.requireAvailable(input);
    const address = this.requireStorage(value);
    const bytes = await this.storageCall(() =>
      this.options.storage.read({ projectId: input.projectId, address }),
    );
    if (!bytes)
      throw new StoredObjectBytesMissingError(input.projectId, input.id);
    return { metadata: this.metadata(value), bytes };
  }

  async resolveDelivery(input: {
    projectId: string;
    id: string;
    audience: StoredObjectDeliveryAudience;
  }): Promise<StoredObjectsGetOutput> {
    const value = await this.requireAvailable(input);
    if (!value.audiences.includes(input.audience)) {
      throw new StoredObjectNotFoundError();
    }
    return {
      metadata: this.metadata(value),
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
    const value = await this.requireAvailable(input);
    if (
      value.generation !== input.generation ||
      !value.audiences.includes(input.audience)
    ) {
      throw new StoredObjectNotFoundError();
    }
    return this.getById(input);
  }

  async delete(
    input: DeleteStoredObjectInput,
  ): Promise<StoredObjectsDeleteOutput> {
    const value = await this.options.store.find({
      tenantId: input.projectId,
      id: input.id,
    });
    if (!value) throw new StoredObjectNotFoundError();
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
      const cleaned = await this.tryDeleteStorage({
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
  }) {
    const query: { tenantId: string; purpose?: string } = {
      tenantId: input.projectId,
    };
    if (input.purpose) query.purpose = input.purpose;
    const usage = await this.options.store.getUsage(query);
    const result: StoredObjectStorageUsage = {
      projectId: input.projectId,
      ...usage,
    };
    if (input.purpose) result.purpose = input.purpose;
    return result;
  }

  async deleteOwnedBy(input: {
    projectId: string;
  }): Promise<DeleteProjectStoredObjectsResult> {
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
      if (afterId) query.afterId = afterId;
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
      if (page.length < limit) break;
      afterId = page.at(-1)?.id;
      if (!afterId) break;
    }
    return {
      projectId: input.projectId,
      deletedObjectCount,
      deletedByteLength,
      status: "completed",
    };
  }

  /** Bounded retry for pending uploads that have expired. */
  async cleanupExpiredUploads(input: {
    projectId: string;
    limit?: number;
  }): Promise<number> {
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
        !(await this.tryDeleteStorage({
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
  async cleanupDeletedObjects(input: {
    projectId: string;
    limit?: number;
  }): Promise<number> {
    const now = this.now();
    const page = await this.options.store.findPage({
      tenantId: input.projectId,
      status: "deleted",
      limit: input.limit ?? this.options.cleanupBatchSize ?? 100,
    });
    let cleaned = 0;
    for (const value of page) {
      if (!value.storage) continue;
      if (
        !(await this.tryDeleteStorage({
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

  private async requireAvailable(input: {
    projectId: string;
    id: string;
  }): Promise<StoredObjectRecord> {
    const value = await this.options.store.find({
      tenantId: input.projectId,
      id: input.id,
    });
    if (!value) throw new StoredObjectNotFoundError();
    if (value.status === "deleted") {
      throw new StoredObjectDeletedError(input.projectId, input.id);
    }
    if (value.status !== "available") {
      throw new StoredObjectUnavailableError(input.projectId, input.id);
    }
    return value;
  }

  private metadata(value: StoredObjectRecord): StoredObjectMetadata {
    const result: StoredObjectMetadata = {
      projectId: value.tenantId,
      id: value.id,
      sha256: value.sha256,
      byteLength: value.byteLength,
      mediaType: value.mediaType,
      mediaTypeVerified: value.mediaTypeVerified,
      status: value.status,
      audiences: [...value.audiences],
      generation: value.generation,
      provenance: {
        purpose: value.purpose,
        ownerKind: value.ownerKind,
        ownerId: value.ownerId,
      },
      createdAt: value.createdAt.toISOString(),
    };
    if (value.availableAt) result.availableAt = value.availableAt.toISOString();
    if (value.deletedAt) result.deletedAt = value.deletedAt.toISOString();
    return result;
  }

  private reference(value: StoredObjectRecord): StoredObjectReference {
    return {
      projectId: value.tenantId,
      id: value.id,
      sha256: value.sha256,
      byteLength: value.byteLength,
      filename: value.filename,
      mediaType: value.mediaType,
      audience: value.audiences[0] ?? "project:view",
    };
  }

  private requireStorage(
    value: StoredObjectRecord,
  ): StoredObjectStorageAddress {
    if (!value.storage) {
      throw new StoredObjectBytesMissingError(value.tenantId, value.id);
    }
    return value.storage;
  }

  private assertByteFacts(value: StoredObjectRecord, byteLength: number): void {
    if (value.byteLength !== byteLength) {
      throw new StoredObjectIntegrityConflictError(
        value.tenantId,
        value.id,
        value.byteLength,
        byteLength,
      );
    }
  }

  private async readBounded(
    source: StoreStoredObjectFromBytesInput["bytes"],
  ): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    const values = source instanceof Uint8Array ? [source] : source;
    for await (const chunk of values) {
      byteLength += chunk.byteLength;
      if (byteLength > this.options.maximumUploadBytes) {
        throw new UploadTooLargeError(
          byteLength,
          this.options.maximumUploadBytes,
        );
      }
      chunks.push(chunk);
    }
    const result = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }

  private async decodeUploadToken(token: string) {
    try {
      return await this.options.uploadTokens.decode(token);
    } catch {
      throw new UploadTokenInvalidError();
    }
  }

  private async storageCall<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof DirectUploadUnavailableError ||
        error instanceof StoredObjectBytesMissingError
      ) {
        throw error;
      }
      throw new StorageUnavailableError();
    }
  }

  private async ignoreStorageFailure(operation: () => Promise<void>) {
    try {
      await operation();
    } catch {
      // The row remains a durable cleanup record for the next bounded pass.
    }
  }

  private async tryDeleteStorage(input: {
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
