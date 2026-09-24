/**
 * The write half of the stored-object lifecycle (ADR-158 §4): bytes arriving
 * in-process, and create, PUT to a signed URL, confirm. Every id is a fresh
 * KSUID and every digest is taken as the bytes stream.
 */
import { ValidationError } from "@langwatch/handled-error";
import {
  DirectUploadUnavailableError,
  StorageUnavailableError,
  StoredObjectBytesMissingError,
  StoredObjectDeletedError,
  StoredObjectIntegrityConflictError,
  StoredObjectNotFoundError,
  UploadExpiredError,
  UploadIncompleteError,
  UploadTokenInvalidError,
  UploadTooLargeError,
  isRefusedUploadMediaType,
  purposePolicyOf,
  type ConfirmStoredObjectUploadInput,
  type CreateStoredObjectUploadInput,
  type StoreStoredObjectFromBytesInput,
  type StoreStoredObjectFromBytesResult,
  type StoredObjectByteStream,
  type StoredObjectReference,
  type StoredObjectUploadBody,
  type StoredObjectsCreateUploadOutput,
  type WriteStoredObjectUploadInput,
} from "@langwatch/stored-object-contract";
import { type Instant, Temporal, toDate } from "@langwatch/time";

import type {
  StoredObjectStorage,
  StoredObjectStorageAddress,
} from "../app/stored-object.members.ts";
import type {
  StoredObjectRecord,
  StoredObjectRecordRepository,
} from "../repositories/stored-object-record.repository.ts";
import { storedObjectReferenceOf } from "../rules/stored-object-view.rules.ts";
import type { StoredObjectUploadSignerService } from "./stored-object-upload-signer.service.ts";

export type StoredObjectUploadServiceOptions = Readonly<{
  records: StoredObjectRecordRepository;
  storage: StoredObjectStorage;
  signer: StoredObjectUploadSignerService;
  maximumUploadBytes: number;
  uploadExpiryMs: number;
  now: () => Instant;
  newId: () => string;
}>;

export class StoredObjectUploadService {
  static create(options: StoredObjectUploadServiceOptions): StoredObjectUploadService {
    return new StoredObjectUploadService(options);
  }

  private constructor(private readonly options: StoredObjectUploadServiceOptions) {}

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
      throw new StoredObjectIntegrityConflictError({
        projectId: value.tenantId,
        objectId: value.id,
        expectedByteLength: value.byteLength,
        actualByteLength: byteLength,
      });
    }
  }

  async storeFromBytes(
    input: StoreStoredObjectFromBytesInput,
  ): Promise<StoreStoredObjectFromBytesResult> {
    const { chunks, byteLength } = await this.measured(input.bytes);
    const id = this.options.newId();
    const { address } = await StoredObjectUploadService.storageCall(() =>
      this.options.storage.place({ projectId: input.projectId, objectId: id }),
    );
    const digest = await StoredObjectUploadService.storageCall(() =>
      this.options.storage.write({
        projectId: input.projectId,
        address,
        body: streamOf(chunks),
        byteLength,
        mediaType: input.mediaType,
      }),
    );
    const now = this.options.now();
    const record: StoredObjectRecord = {
      tenantId: input.projectId,
      id,
      status: "available",
      purpose: input.purpose,
      ownerKind: input.ownerKind,
      ownerId: input.ownerId,
      filename: input.filename,
      sha256: digest.sha256,
      byteLength: digest.byteLength,
      mediaType: input.mediaType,
      mediaTypeVerified: true,
      storage: address,
      generation: 1,
      audiences: [input.audience],
      expiresAt: null,
      availableAt: now,
      deletedAt: null,
      source: "canonical",
      legacyFingerprint: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.recordOrDiscard(record, address);

    return { reference: storedObjectReferenceOf(record), isDuplicate: false };
  }

  async createUpload(
    input: CreateStoredObjectUploadInput,
  ): Promise<StoredObjectsCreateUploadOutput> {
    const policy = purposePolicyOf(input.purpose);
    if (!policy.uploadable) {
      throw refusedField("purpose", "Files with this purpose cannot be uploaded.");
    }
    if (isRefusedUploadMediaType(input.mediaType)) {
      throw refusedField("mediaType", "Files of this type cannot be uploaded.");
    }

    const id = this.options.newId();
    const placement = await StoredObjectUploadService.storageCall(() =>
      this.options.storage.place({ projectId: input.projectId, objectId: id }),
    );
    const limit = Math.min(policy.maxBytes, placement.maxSinglePutBytes);
    if (input.byteLength > limit) throw new UploadTooLargeError(input.byteLength, limit);

    const now = this.options.now();
    const expiresAt = now.add({ milliseconds: this.options.uploadExpiryMs });
    const signed = await StoredObjectUploadService.storageCall(() =>
      this.options.storage.signUpload({
        projectId: input.projectId,
        address: placement.address,
        byteLength: input.byteLength,
        mediaType: input.mediaType,
        expiresAt,
      }),
    );
    await this.options.records.upsert(
      pendingUploadRecord({ input, id, address: placement.address, expiresAt, now }),
    );
    const target =
      signed.kind === "direct"
        ? { uploadUrl: signed.url, headers: { ...signed.headers } }
        : {
            uploadUrl: this.options.signer.urlFor({
              projectId: input.projectId,
              objectId: id,
              byteLength: input.byteLength,
              mediaType: input.mediaType,
              expiresAt,
            }),
          };

    return {
      objectId: id,
      method: "PUT",
      expiresAt: toDate(expiresAt).toISOString(),
      ...target,
    };
  }

  async writeUpload(input: WriteStoredObjectUploadInput): Promise<void> {
    const seal = this.options.signer.open({
      objectId: input.objectId,
      signature: input.signature,
      now: this.options.now(),
    });
    if (input.contentLength !== undefined && input.contentLength > seal.byteLength) {
      throw new UploadTooLargeError(input.contentLength, seal.byteLength);
    }

    const value = await this.options.records.findById({
      tenantId: seal.projectId,
      id: input.objectId,
    });
    if (value?.status !== "pending" || !value.storage) throw new UploadTokenInvalidError();

    if (!input.body) throw new UploadIncompleteError();

    const address = value.storage;
    try {
      await this.options.storage.write({
        projectId: seal.projectId,
        address,
        body: chunksOf(input.body),
        byteLength: seal.byteLength,
        mediaType: seal.mediaType,
      });
    } catch (error) {
      throw writeRefusalOf(error, seal.byteLength);
    }
  }

  async confirmUpload(input: ConfirmStoredObjectUploadInput): Promise<StoredObjectReference> {
    const value = await this.options.records.findById({
      tenantId: input.projectId,
      id: input.objectId,
    });
    if (!value) throw new StoredObjectNotFoundError();
    if (value.status === "available") return storedObjectReferenceOf(value);
    if (value.status === "deleted")
      throw new StoredObjectDeletedError(input.projectId, input.objectId);
    if (value.status !== "pending" || !value.storage) throw new UploadIncompleteError();

    const isExpired =
      value.expiresAt === null ||
      Temporal.Instant.compare(value.expiresAt, this.options.now()) <= 0;
    if (isExpired) throw new UploadExpiredError();

    const address = value.storage;
    const digest = await StoredObjectUploadService.storageCall(() =>
      this.options.storage.tryStat({ projectId: input.projectId, address }),
    );
    if (!digest) throw new UploadIncompleteError();

    StoredObjectUploadService.assertByteFacts(value, digest.byteLength);
    const now = this.options.now();
    const available: StoredObjectRecord = {
      ...value,
      status: "available",
      sha256: digest.sha256,
      mediaTypeVerified: true,
      generation: value.generation + 1,
      expiresAt: null,
      availableAt: now,
      updatedAt: now,
    };
    await this.options.records.upsert(available);

    return storedObjectReferenceOf(available);
  }

  /** In-process bytes: a buffer is written as it is; a stream is counted within the ceiling. */
  private async measured(
    source: StoreStoredObjectFromBytesInput["bytes"],
  ): Promise<{ chunks: readonly Uint8Array[]; byteLength: number }> {
    if (source instanceof Uint8Array) {
      this.assertWithinCeiling(source.byteLength);

      return { chunks: [source], byteLength: source.byteLength };
    }

    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    for await (const chunk of source) {
      byteLength += chunk.byteLength;
      this.assertWithinCeiling(byteLength);
      chunks.push(chunk);
    }

    return { chunks, byteLength };
  }

  private assertWithinCeiling(byteLength: number): void {
    if (byteLength > this.options.maximumUploadBytes) {
      throw new UploadTooLargeError(byteLength, this.options.maximumUploadBytes);
    }
  }

  private async recordOrDiscard(
    record: StoredObjectRecord,
    address: StoredObjectStorageAddress,
  ): Promise<void> {
    try {
      await this.options.records.upsert(record);
    } catch (error) {
      await StoredObjectUploadService.ignoreStorageFailure(() =>
        this.options.storage.delete({ projectId: record.tenantId, address }),
      );

      throw error;
    }
  }
}

function refusedField(field: "purpose" | "mediaType", message: string): ValidationError {
  return new ValidationError(message, { meta: { fieldErrors: { [field]: [message] } } });
}

/** The member refuses a body past or short of its declared length, and keeps nothing. */
function writeRefusalOf(error: unknown, byteLength: number): Error {
  const name = error instanceof Error ? error.name : "";
  if (name === "ObjectBodyTooLargeError")
    return new UploadTooLargeError(byteLength + 1, byteLength);
  if (name === "ObjectBodyShortError") return new UploadIncompleteError();

  return new StorageUnavailableError();
}

async function* chunksOf(body: StoredObjectUploadBody): StoredObjectByteStream {
  const reader = body.getReader();
  try {
    for (let next = await reader.read(); !next.done; next = await reader.read()) yield next.value;
  } finally {
    reader.releaseLock();
  }
}

async function* streamOf(chunks: readonly Uint8Array[]): StoredObjectByteStream {
  yield* chunks;
}

/** The row a signed upload leaves behind while its bytes are still in flight. */
function pendingUploadRecord({
  input,
  id,
  address,
  expiresAt,
  now,
}: {
  input: CreateStoredObjectUploadInput;
  id: StoredObjectRecord["id"];
  address: StoredObjectStorageAddress;
  expiresAt: Instant;
  now: Instant;
}): StoredObjectRecord {
  return {
    tenantId: input.projectId,
    id,
    status: "pending",
    purpose: input.purpose,
    ownerKind: "project",
    ownerId: input.projectId,
    filename: input.filename,
    sha256: "",
    byteLength: input.byteLength,
    mediaType: input.mediaType,
    mediaTypeVerified: false,
    storage: address,
    generation: 0,
    audiences: ["project:view"],
    expiresAt,
    availableAt: null,
    deletedAt: null,
    source: "canonical",
    legacyFingerprint: null,
    createdAt: now,
    updatedAt: now,
  };
}
