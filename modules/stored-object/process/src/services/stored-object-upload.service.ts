/**
 * The write half of the stored-object lifecycle (ADR-158 §4): bytes arriving
 * in-process, and create, PUT to a signed URL, confirm. In-process bytes reuse
 * an available object holding the same content (ADR-002); every new id is a KSUID.
 */
import { createHash } from "node:crypto";

import {
  type DataRetentionApi,
  INDEFINITE_RETENTION_DAYS,
} from "@langwatch/data-retention-contract";
import { HandledError, ValidationError } from "@langwatch/handled-error";
import { ObjectBodyShortError, ObjectBodyTooLargeError } from "@langwatch/process-stores";
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
  StoredObjectOwnerLink,
  StoredObjectOwnerLinkRepository,
} from "../repositories/stored-object-owner-link.repository.ts";
import type {
  StoredObjectRecord,
  StoredObjectRecordRepository,
} from "../repositories/stored-object-record.repository.ts";
import { storedObjectReferenceOf } from "../rules/stored-object-view.rules.ts";
import type { StoredObjectUploadSignerService } from "./stored-object-upload-signer.service.ts";

/** The one retention question a store asks: how long its category keeps the project's data. */
export type StoredObjectRetention = Pick<DataRetentionApi, "getRetentionDays">;

/** An owner link before it names its object. */
type StoredObjectOwnerClaim = Omit<StoredObjectOwnerLink, "objectId">;

type StoredObjectUploadServiceOptions = Readonly<{
  records: StoredObjectRecordRepository;
  ownerLinks: StoredObjectOwnerLinkRepository;
  retention: StoredObjectRetention;
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
    const owners = await this.ownerClaimsOf(input);
    const reusable = await this.options.records.findReusable({
      tenantId: input.projectId,
      purpose: input.purpose,
      sha256: sha256Of(chunks),
      mediaType: input.mediaType,
    });
    for (const candidate of reusable) {
      if (candidate.byteLength !== byteLength) continue;
      await this.link({ objectId: candidate.id, owners });
      // A delete may win between the read and the link (ADR-002 §4): never answer it.
      const current =
        owners.length > 0
          ? await this.options.records.findById({ tenantId: candidate.tenantId, id: candidate.id })
          : candidate;
      if (current?.status !== "available") continue;
      const reused = await this.withAudience({ value: current, audience: input.audience });

      return { reference: storedObjectReferenceOf(reused), isDuplicate: true };
    }

    const record = await this.storeNew({ input, chunks, byteLength });
    await this.link({ objectId: record.id, owners });

    return { reference: storedObjectReferenceOf(record), isDuplicate: false };
  }

  /** Writes the bytes under a fresh id, then the row; the bytes go if the row cannot be written. */
  private async storeNew({
    input,
    chunks,
    byteLength,
  }: {
    input: StoreStoredObjectFromBytesInput;
    chunks: readonly Uint8Array[];
    byteLength: number;
  }): Promise<StoredObjectRecord> {
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

    return record;
  }

  /** The caller's link if its purpose declares a retention category (ADR-002 §3), else none. */
  private async ownerClaimsOf(
    input: StoreStoredObjectFromBytesInput,
  ): Promise<StoredObjectOwnerClaim[]> {
    const category = purposePolicyOf(input.purpose).retentionCategory;
    if (category === undefined) return [];

    const days = await this.options.retention.getRetentionDays({
      projectId: input.projectId,
      category,
    });
    const now = this.options.now();

    return [
      {
        tenantId: input.projectId,
        ownerKind: input.ownerKind,
        ownerId: input.ownerId,
        // Indefinite retention holds with no end; `now + 0` would end it at once.
        retainUntil: days === INDEFINITE_RETENTION_DAYS ? null : now.add({ hours: days * 24 }),
        createdAt: now,
        updatedAt: now,
      },
    ];
  }

  private async link({
    objectId,
    owners,
  }: {
    objectId: StoredObjectRecord["id"];
    owners: readonly StoredObjectOwnerClaim[];
  }): Promise<void> {
    for (const owner of owners) await this.options.ownerLinks.raise({ ...owner, objectId });
  }

  /** The row with the caller's audience added; the write changes only a row still available. */
  private async withAudience({
    value,
    audience,
  }: {
    value: StoredObjectRecord;
    audience: StoreStoredObjectFromBytesInput["audience"];
  }): Promise<StoredObjectRecord> {
    if (value.audiences.includes(audience)) return value;

    const at = this.options.now();
    await this.options.records.addAudience({
      tenantId: value.tenantId,
      id: value.id,
      audience,
      at,
    });

    return { ...value, audiences: [...value.audiences, audience], updatedAt: at };
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
      this.options.storage.getStat({ projectId: input.projectId, address }),
    ).catch((error: unknown) => {
      if (error instanceof HandledError && error.code === "stored_object_not_found") {
        throw new UploadIncompleteError();
      }
      throw error;
    });

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

function sha256Of(chunks: readonly Uint8Array[]): string {
  const hash = createHash("sha256");
  for (const chunk of chunks) hash.update(chunk);

  return hash.digest("hex");
}

function assertWithinCeiling(byteLength: number, ceiling: number): void {
  if (byteLength > ceiling) throw new UploadTooLargeError(byteLength, ceiling);
}

function refusedField(field: "purpose" | "mediaType", message: string): ValidationError {
  return new ValidationError(message, { meta: { fieldErrors: { [field]: [message] } } });
}

/** The member refuses a body past or short of its declared length, and keeps nothing. */
function writeRefusalOf(error: unknown, byteLength: number): Error {
  if (error instanceof ObjectBodyTooLargeError)
    return new UploadTooLargeError(byteLength + 1, byteLength);
  if (error instanceof ObjectBodyShortError) return new UploadIncompleteError();

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
