/**
 * The write half of the stored-object lifecycle: bytes arriving in-process, and the
 * presigned direct-upload handshake. The read, delete and cleanup halves stay on
 * `StoredObjectService`, which composes this one.
 */
import { createHash } from "node:crypto";
import {
  DirectUploadUnavailableError,
  StorageUnavailableError,
  StoredObjectBytesMissingError,
  StoredObjectIntegrityConflictError,
  UploadChecksumMismatchError,
  UploadExpiredError,
  UploadIncompleteError,
  UploadTokenInvalidError,
  UploadTooLargeError,
  type ConfirmStoredObjectUploadInput,
  type CreateStoredObjectUploadInput,
  type StoreStoredObjectFromBytesInput,
  type StoreStoredObjectFromBytesResult,
  type StoredObjectReference,
  type StoredObjectsCreateUploadOutput,
} from "@langwatch/stored-object-contract";
import { storedObjectReferenceOf } from "../rules/stored-object-view.rules.ts";
import type { StoredObjectUploadTokenClaims } from "../ports/stored-object.port.ts";
import type { StoredObjectRecord } from "../stores/stored-object.store.ts";
import type { StoredObjectServiceOptions } from "./stored-object.service.ts";

export class StoredObjectUploadService {
  static create(
    options: StoredObjectServiceOptions & {
      now: () => Date;
      operationId: () => string;
    },
  ): StoredObjectUploadService {
    return new StoredObjectUploadService(options);
  }

  private readonly now: () => Date;
  private readonly operationId: () => string;

  private constructor(
    private readonly options: StoredObjectServiceOptions & {
      now: () => Date;
      operationId: () => string;
    },
  ) {
    this.now = options.now;
    this.operationId = options.operationId;
  }

  static async storageCall<T>(operation: () => Promise<T>): Promise<T> {
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

  static async ignoreStorageFailure(operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch {
      // The row remains a durable cleanup record for the next bounded pass.
    }
  }

  static assertByteFacts(value: StoredObjectRecord, byteLength: number): void {
    if (value.byteLength !== byteLength) {
      throw new StoredObjectIntegrityConflictError(
        value.tenantId,
        value.id,
        value.byteLength,
        byteLength,
      );
    }
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
    const existing = await this.options.store.tryFind({
      tenantId: input.projectId,
      id,
    });
    if (existing?.status === "available") {
      StoredObjectUploadService.assertByteFacts(existing, bytes.byteLength);
      if (!existing.audiences.includes(input.audience)) {
        await this.options.store.save({
          ...existing,
          audiences: [...existing.audiences, input.audience],
          updatedAt: this.now(),
        });
      }

      return { reference: storedObjectReferenceOf(existing), isDuplicate: true };
    }

    const address = await StoredObjectUploadService.storageCall(() =>
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
      await StoredObjectUploadService.ignoreStorageFailure(() =>
        this.options.storage.delete({ projectId: input.projectId, address }),
      );

      throw error;
    }

    return { reference: storedObjectReferenceOf(record), isDuplicate: false };
  }

  async createUpload(
    input: CreateStoredObjectUploadInput,
  ): Promise<StoredObjectsCreateUploadOutput> {
    if (input.byteLength > this.options.maximumUploadBytes) {
      throw new UploadTooLargeError(input.byteLength, this.options.maximumUploadBytes);
    }

    const id = await this.options.idDeriver.fromDigest({
      projectId: input.projectId,
      sha256: input.sha256,
    });
    const existing = await this.options.store.tryFind({
      tenantId: input.projectId,
      id,
    });
    if (existing?.status === "available") {
      StoredObjectUploadService.assertByteFacts(existing, input.byteLength);

      return { status: "existing", reference: storedObjectReferenceOf(existing) };
    }

    const operationId = this.operationId();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.options.uploadExpiryMs);
    const upload = await StoredObjectUploadService.storageCall(() =>
      this.options.storage.tryCreateUpload({
        projectId: input.projectId,
        objectId: id,
        byteLength: input.byteLength,
        sha256: input.sha256,
        mediaType: input.mediaType,
        expiresAt,
      }),
    );
    if (!upload) {
      throw new DirectUploadUnavailableError();
    }

    const record = pendingUploadRecord({ input, id, upload, expiresAt, now, existing });
    try {
      await this.options.store.save(record);
    } catch (error) {
      await StoredObjectUploadService.ignoreStorageFailure(() =>
        this.options.storage.delete({
          projectId: input.projectId,
          address: upload.address,
        }),
      );

      throw error;
    }

    const reference = storedObjectReferenceOf(record);
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

  async confirmUpload(input: ConfirmStoredObjectUploadInput): Promise<StoredObjectReference> {
    const claims = await this.decodeUploadToken(input.uploadToken);
    if (claims.projectId !== input.projectId) {
      throw new UploadTokenInvalidError();
    }

    const value = await this.options.store.tryFind({
      tenantId: claims.projectId,
      id: claims.objectId,
    });
    if (!value || value.status !== "pending") {
      if (value?.status === "available") {
        return storedObjectReferenceOf(value);
      }

      throw new UploadIncompleteError(claims.operationId);
    }

    if (value.expiresAt === null || value.expiresAt.getTime() <= this.now().getTime()) {
      throw new UploadExpiredError(claims.operationId);
    }

    const stat = await StoredObjectUploadService.storageCall(() =>
      this.options.storage.tryStat({
        projectId: claims.projectId,
        address: claims.address,
      }),
    );
    if (!stat) {
      throw new UploadIncompleteError(claims.operationId);
    }

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

    return storedObjectReferenceOf(available);
  }

  private async readBounded(source: StoreStoredObjectFromBytesInput["bytes"]): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    const values = source instanceof Uint8Array ? [source] : source;
    for await (const chunk of values) {
      byteLength += chunk.byteLength;
      if (byteLength > this.options.maximumUploadBytes) {
        throw new UploadTooLargeError(byteLength, this.options.maximumUploadBytes);
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

  private async decodeUploadToken(token: string): Promise<StoredObjectUploadTokenClaims> {
    try {
      return await this.options.uploadTokens.decode(token);
    } catch {
      throw new UploadTokenInvalidError();
    }
  }
}

/** The row a presigned upload leaves behind while its bytes are still in flight. */
function pendingUploadRecord({
  input,
  id,
  upload,
  expiresAt,
  now,
  existing,
}: {
  input: CreateStoredObjectUploadInput;
  id: StoredObjectRecord["id"];
  upload: { address: StoredObjectRecord["storage"] };
  expiresAt: Date;
  now: Date;
  existing: StoredObjectRecord | null;
}): StoredObjectRecord {
  return {
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
}
