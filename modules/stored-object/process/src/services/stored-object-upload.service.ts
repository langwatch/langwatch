/**
 * The write half of the stored-object lifecycle (ADR-158 §4): bytes arriving
 * in-process, and create, PUT to a signed URL, confirm. Every id is a fresh
 * KSUID and every digest is taken as the bytes stream.
 */
import { HandledError, ValidationError } from "@langwatch/handled-error";
import type { ObjectDigest } from "@langwatch/process-stores/members";
import {
  DirectUploadUnavailableError,
  StorageUnavailableError,
  StoredObjectBytesMissingError,
  StoredObjectDeletedError,
  StoredObjectNotFoundError,
  UploadExpiredError,
  UploadIncompleteError,
  UploadTooLargeError,
  isRefusedUploadMediaType,
  purposeByteLimitOf,
  purposePolicyOf,
  type ConfirmStoredObjectUploadInput,
  type CreateStoredObjectUploadInput,
  type StoreStoredObjectFromBytesInput,
  type StoreStoredObjectFromBytesResult,
  type StoredObjectByteStream,
  type StoredObjectReference,
  type StoredObjectsCreateUploadOutput,
  type WriteStoredObjectUploadInput,
} from "@langwatch/stored-object-contract";
import { type Instant, Temporal, toDate } from "@langwatch/time";

import type {
  StoredObjectBytesRepository,
  StoredObjectStorageAddress,
} from "../repositories/stored-object-bytes.repository.ts";
import type {
  StoredObjectRecord,
  StoredObjectRecordRepository,
} from "../repositories/stored-object-record.repository.ts";
import {
  assertByteFacts,
  isLanded,
  landedDigestOf,
  movedOn,
} from "../rules/stored-object-lifecycle.rules.ts";
import { storedObjectReferenceOf } from "../rules/stored-object-view.rules.ts";
import { StoredObjectUploadReceiveService } from "./stored-object-upload-receive.service.ts";
import type { StoredObjectUploadSignerService } from "./stored-object-upload-signer.service.ts";

type StoredObjectUploadServiceOptions = Readonly<{
  records: StoredObjectRecordRepository;
  storage: StoredObjectBytesRepository;
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

  private readonly receiver: StoredObjectUploadReceiveService;

  private constructor(private readonly options: StoredObjectUploadServiceOptions) {
    this.receiver = StoredObjectUploadReceiveService.create(options);
  }

  static async storageCall<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof DirectUploadUnavailableError ||
        error instanceof StoredObjectBytesMissingError ||
        error instanceof StoredObjectNotFoundError
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

  async storeFromBytes(
    input: StoreStoredObjectFromBytesInput,
  ): Promise<StoreStoredObjectFromBytesResult> {
    const ceiling =
      input.maxBytes === undefined
        ? this.options.maximumUploadBytes
        : purposeByteLimitOf(purposePolicyOf(input.purpose), input.maxBytes);
    const { chunks, byteLength } = await this.measured(input.bytes, ceiling);
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
    const limit = Math.min(purposeByteLimitOf(policy, input.maxBytes), placement.maxSinglePutBytes);
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

  writeUpload(input: WriteStoredObjectUploadInput): Promise<void> {
    return this.receiver.writeUpload(input);
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
    // "uploading": the bytes are still arriving through the process; the client retries.
    if (value.status !== "pending" || !value.storage) throw new UploadIncompleteError();

    const digest = isLanded(value) ? landedDigestOf(value) : await this.unseenDigestOf(value);

    assertByteFacts(value, digest.byteLength);
    const now = this.options.now();
    const available = movedOn({
      value,
      now,
      changes: {
        status: "available",
        sha256: digest.sha256,
        mediaTypeVerified: true,
        expiresAt: null,
        availableAt: now,
      },
    });
    if (await this.options.records.transition({ expected: value, next: available })) {
      return storedObjectReferenceOf(available);
    }

    return this.answerAfterLostConfirm(input);
  }

  /** Another write moved the row first: answer from what it holds now. */
  private async answerAfterLostConfirm(
    input: ConfirmStoredObjectUploadInput,
  ): Promise<StoredObjectReference> {
    const current = await this.options.records.findById({
      tenantId: input.projectId,
      id: input.objectId,
    });
    if (current?.status === "available") return storedObjectReferenceOf(current);
    if (current?.status === "deleted") {
      throw new StoredObjectDeletedError(input.projectId, input.objectId);
    }
    throw new UploadIncompleteError();
  }

  /** A direct upload's bytes, which LangWatch never saw: its window still applies. */
  private async unseenDigestOf(value: StoredObjectRecord): Promise<ObjectDigest> {
    const isExpired =
      value.expiresAt === null ||
      Temporal.Instant.compare(value.expiresAt, this.options.now()) <= 0;
    if (isExpired) throw new UploadExpiredError();

    const address = value.storage;
    if (!address) throw new UploadIncompleteError();

    return StoredObjectUploadService.storageCall(() =>
      this.options.storage.getStat({ projectId: value.tenantId, address }),
    ).catch((error: unknown) => {
      if (error instanceof HandledError && error.code === "stored_object_not_found") {
        throw new UploadIncompleteError();
      }
      throw error;
    });
  }

  /** In-process bytes: a buffer is written as it is; a stream is counted within the ceiling. */
  private async measured(
    source: StoreStoredObjectFromBytesInput["bytes"],
    ceiling: number,
  ): Promise<{ chunks: readonly Uint8Array[]; byteLength: number }> {
    if (source instanceof Uint8Array) {
      assertWithinCeiling(source.byteLength, ceiling);

      return { chunks: [source], byteLength: source.byteLength };
    }

    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    for await (const chunk of source) {
      byteLength += chunk.byteLength;
      assertWithinCeiling(byteLength, ceiling);
      chunks.push(chunk);
    }

    return { chunks, byteLength };
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

function assertWithinCeiling(byteLength: number, ceiling: number): void {
  if (byteLength > ceiling) throw new UploadTooLargeError(byteLength, ceiling);
}

function refusedField(field: "purpose" | "mediaType", message: string): ValidationError {
  return new ValidationError(message, { meta: { fieldErrors: { [field]: [message] } } });
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
    audiences: [purposePolicyOf(input.purpose).readPermission],
    expiresAt,
    availableAt: null,
    deletedAt: null,
    source: "canonical",
    legacyFingerprint: null,
    createdAt: now,
    updatedAt: now,
  };
}
