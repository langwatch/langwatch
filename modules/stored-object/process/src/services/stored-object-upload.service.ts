/**
 * The write half of the stored-object lifecycle (ADR-158 §4): bytes arriving
 * in-process, and create, PUT to a signed URL, confirm. Every id is a fresh
 * KSUID and every digest is taken as the bytes stream.
 */
import { HandledError, ValidationError } from "@langwatch/handled-error";
import { ObjectBodyShortError, ObjectBodyTooLargeError } from "@langwatch/process-stores";
import type { ObjectDigest } from "@langwatch/process-stores/members";
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
  purposeByteLimitOf,
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
  StoredObjectBytesRepository,
  StoredObjectStorageAddress,
} from "../repositories/stored-object-bytes.repository.ts";
import type {
  StoredObjectRecord,
  StoredObjectRecordRepository,
} from "../repositories/stored-object-record.repository.ts";
import { movedOn } from "../rules/stored-object-lifecycle.rules.ts";
import { storedObjectReferenceOf } from "../rules/stored-object-view.rules.ts";
import type { StoredObjectUploadSignerService } from "./stored-object-upload-signer.service.ts";

/** How long a landed upload waits for its confirm before the reaper takes it (ADR-158 §4). */
const LANDED_CONFIRM_WINDOW_MS = 24 * 60 * 60 * 1000;

/** How long the reaper leaves an "uploading" row alone: past the api's two-hour body limit. */
const UPLOAD_RECEIVE_WINDOW_MS = 3 * 60 * 60 * 1000;

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

  private constructor(private readonly options: StoredObjectUploadServiceOptions) {}

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
    if (value?.status === "uploading") throw new UploadIncompleteError();
    if (value?.status !== "pending" || !value.storage) throw new UploadTokenInvalidError();
    // The signed address was used: its bytes landed. A new file takes a new upload.
    if (isLanded(value)) throw new UploadTokenInvalidError();

    if (!input.body) throw new UploadIncompleteError();

    const address = value.storage;
    const receivingAt = this.options.now();
    const uploading = movedOn({
      value,
      now: receivingAt,
      changes: {
        status: "uploading",
        expiresAt: receivingAt.add({ milliseconds: UPLOAD_RECEIVE_WINDOW_MS }),
      },
    });
    if (!(await this.options.records.transition({ expected: value, next: uploading }))) {
      throw new UploadIncompleteError();
    }

    const client = { broke: false };
    let digest: ObjectDigest;
    try {
      digest = await this.options.storage.write({
        projectId: seal.projectId,
        address,
        body: chunksOf(input.body, client),
        byteLength: seal.byteLength,
        mediaType: seal.mediaType,
      });
    } catch (error) {
      await this.restorePending({ uploading, expiresAt: value.expiresAt });
      throw writeRefusalOf({ error, byteLength: seal.byteLength, clientBroke: client.broke });
    }

    await this.recordLanded({ uploading, digest, expiresAt: value.expiresAt });
  }

  /** A write that failed hands the row back as it was, so the reaper keeps its first schedule. */
  private async restorePending(input: {
    uploading: StoredObjectRecord;
    expiresAt: Instant | null;
  }): Promise<void> {
    const pending = movedOn({
      value: input.uploading,
      now: this.options.now(),
      changes: { status: "pending", expiresAt: input.expiresAt },
    });
    await this.options.records.transition({ expected: input.uploading, next: pending });
  }

  /** Keeps the digest the write took, so confirm reads nothing back (#9666). */
  private async recordLanded(input: {
    uploading: StoredObjectRecord;
    digest: ObjectDigest;
    /** The pending row's own expiry, handed back if what landed is refused. */
    expiresAt: Instant | null;
  }): Promise<void> {
    const { uploading, digest } = input;
    const address = uploading.storage;
    if (!address) throw new UploadIncompleteError();

    try {
      StoredObjectUploadService.assertByteFacts(uploading, digest.byteLength);
    } catch (error) {
      await this.restorePending({ uploading, expiresAt: input.expiresAt });
      await this.discarded({ projectId: uploading.tenantId, address });
      throw error;
    }

    const now = this.options.now();
    const landed = movedOn({
      value: uploading,
      now,
      changes: {
        status: "pending",
        sha256: digest.sha256,
        expiresAt: now.add({ milliseconds: LANDED_CONFIRM_WINDOW_MS }),
      },
    });
    if (await this.options.records.transition({ expected: uploading, next: landed })) return;

    // Reaped or deleted while the bytes streamed: what just landed is nobody's.
    const current = await this.options.records.findById({
      tenantId: uploading.tenantId,
      id: uploading.id,
    });
    const isAbandoned = !current || current.status === "failed" || current.status === "deleted";
    if (!isAbandoned) throw new UploadIncompleteError();
    const isGone = await this.discarded({ projectId: uploading.tenantId, address });
    if (current) await this.keepAddressUntilGone({ current, address, isGone });
    if (current?.status === "deleted") {
      throw new StoredObjectDeletedError(uploading.tenantId, uploading.id);
    }
    throw new UploadExpiredError();
  }

  /** A row whose bytes may still be held keeps their address, so a cleanup pass can retry. */
  private async keepAddressUntilGone(input: {
    current: StoredObjectRecord;
    address: StoredObjectStorageAddress;
    isGone: boolean;
  }): Promise<void> {
    const { current, address, isGone } = input;
    const storage = isGone ? null : address;
    const isRecorded = current.storage === storage || (!isGone && current.storage !== null);
    if (isRecorded) return;

    await this.options.records.transition({
      expected: current,
      next: { ...current, storage, updatedAt: this.options.now() },
    });
  }

  private async discarded(input: {
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

    StoredObjectUploadService.assertByteFacts(value, digest.byteLength);
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

/**
 * The member refuses a body past or short of its declared length, and keeps nothing.
 * A client whose body broke off is told its upload is incomplete, not that storage failed.
 */
function writeRefusalOf(input: {
  error: unknown;
  byteLength: number;
  clientBroke: boolean;
}): Error {
  const { error, byteLength } = input;
  if (error instanceof ObjectBodyTooLargeError)
    return new UploadTooLargeError(byteLength + 1, byteLength);
  if (error instanceof ObjectBodyShortError || input.clientBroke)
    return new UploadIncompleteError();

  return new StorageUnavailableError();
}

async function* chunksOf(
  body: StoredObjectUploadBody,
  client: { broke: boolean },
): StoredObjectByteStream {
  const reader = body.getReader();
  const read = () =>
    reader.read().catch((error: unknown) => {
      client.broke = true;
      throw error;
    });
  try {
    for (let next = await read(); !next.done; next = await read()) yield next.value;
  } finally {
    reader.releaseLock();
  }
}

/** A pending row the signed route already wrote holds the digest that write took. */
function isLanded(value: StoredObjectRecord): boolean {
  return value.sha256 !== "";
}

function landedDigestOf(value: StoredObjectRecord): ObjectDigest {
  return { sha256: value.sha256, byteLength: value.byteLength };
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
