/**
 * The signed upload route's half of an upload (ADR-158 §4, #9666): bytes arriving through
 * LangWatch land in the bucket once, and the row keeps the digest that write took.
 */
import { ObjectBodyShortError, ObjectBodyTooLargeError } from "@langwatch/process-stores";
import type { ObjectDigest } from "@langwatch/process-stores/members";
import {
  StorageUnavailableError,
  StoredObjectDeletedError,
  UploadExpiredError,
  UploadIncompleteError,
  UploadTokenInvalidError,
  UploadTooLargeError,
  type StoredObjectByteStream,
  type StoredObjectUploadBody,
  type WriteStoredObjectUploadInput,
} from "@langwatch/stored-object-contract";
import type { Instant } from "@langwatch/time";

import type {
  StoredObjectBytesRepository,
  StoredObjectStorageAddress,
} from "../repositories/stored-object-bytes.repository.ts";
import type {
  StoredObjectRecord,
  StoredObjectRecordRepository,
} from "../repositories/stored-object-record.repository.ts";
import { assertByteFacts, isLanded, movedOn } from "../rules/stored-object-lifecycle.rules.ts";
import type { StoredObjectUploadSignerService } from "./stored-object-upload-signer.service.ts";

/** Writes a lost landing takes to record whether its bytes are still held. */
const MAX_ADDRESS_ATTEMPTS = 3;

/** How long a landed upload waits for its confirm before the reaper takes it (ADR-158 §4). */
const LANDED_CONFIRM_WINDOW_MS = 24 * 60 * 60 * 1000;

/** How long the reaper leaves an "uploading" row alone: past the api's two-hour body limit. */
const UPLOAD_RECEIVE_WINDOW_MS = 3 * 60 * 60 * 1000;

type StoredObjectUploadReceiveServiceOptions = Readonly<{
  records: StoredObjectRecordRepository;
  storage: StoredObjectBytesRepository;
  signer: StoredObjectUploadSignerService;
  now: () => Instant;
}>;

export class StoredObjectUploadReceiveService {
  static create(
    options: StoredObjectUploadReceiveServiceOptions,
  ): StoredObjectUploadReceiveService {
    return new StoredObjectUploadReceiveService(options);
  }

  private constructor(private readonly options: StoredObjectUploadReceiveServiceOptions) {}

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
      assertByteFacts(uploading, digest.byteLength);
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

  /**
   * A row whose bytes may still be held keeps their address under a new generation, so a
   * cleanup that read it before they landed cannot clear it, and an expired deadline, so the
   * reaper retries. Bytes known gone clear both.
   */
  private async keepAddressUntilGone(input: {
    current: StoredObjectRecord;
    address: StoredObjectStorageAddress;
    isGone: boolean;
  }): Promise<void> {
    let current: StoredObjectRecord | null = input.current;
    for (let attempt = 0; current && attempt < MAX_ADDRESS_ATTEMPTS; attempt += 1) {
      const now = this.options.now();
      const next = input.isGone
        ? { ...current, storage: null, expiresAt: null, updatedAt: now }
        : movedOn({ value: current, now, changes: { storage: input.address, expiresAt: now } });
      if (input.isGone && current.storage === null && current.expiresAt === null) return;
      if (await this.options.records.transition({ expected: current, next })) return;

      current = await this.options.records.findById({
        tenantId: current.tenantId,
        id: current.id,
      });
    }
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
