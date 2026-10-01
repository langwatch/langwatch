/**
 * What every object-storage backend answers for one placed project, and the
 * streaming measure each write and digest runs its bytes through (ADR-158).
 */
import { createHash } from "node:crypto";

import { HandledError } from "@langwatch/handled-error";
import type { Instant } from "@langwatch/time";

import type {
  DownloadFacts,
  ObjectBodyFacts,
  ObjectDigest,
  ObjectStorageDestination,
  SignedObjectUpload,
  StoredObjectAddress,
  UploadFacts,
} from "./members.ts";

/** One backend, already placed: the member routes a project to it, then calls it by key. */
export interface ObjectBackend {
  readonly destination: ObjectStorageDestination;
  write(
    at: StoredObjectAddress,
    body: AsyncIterable<Uint8Array>,
    facts: ObjectBodyFacts,
  ): Promise<ObjectDigest>;
  read(at: StoredObjectAddress): Promise<AsyncIterable<Uint8Array>>;
  digest(at: StoredObjectAddress): Promise<ObjectDigest>;
  remove(at: StoredObjectAddress): Promise<void>;
  signUpload(at: StoredObjectAddress, facts: UploadFacts): Promise<SignedObjectUpload>;
  signDownload(at: StoredObjectAddress, facts: DownloadFacts): Promise<string>;
  probe(): Promise<void>;
}

/** The storage root refused a write (EACCES/EPERM/EROFS): a deployment fault an operator fixes. */
export class StorageNotWritableError extends HandledError {
  declare readonly code: "storage_not_writable";

  constructor() {
    super("storage_not_writable", "Storage is not writable, so nothing was saved", {
      httpStatus: 500,
      fault: "platform",
    });
    this.name = "StorageNotWritableError";
  }
}

/** A project whose organization this deployment cannot name. */
export class UnknownStorageProjectError extends Error {
  constructor(readonly projectId: string) {
    super(
      `Cannot store an object: project "${projectId}" has no known organization. ` +
        "Refusing to fall back to the shared backend, which would put its objects " +
        "where another organization's credentials reach them.",
    );
    this.name = "UnknownStorageProjectError";
  }
}

/** An object recorded on a backend this process holds no credentials for. */
export class UnreachableStorageLocationError extends Error {
  constructor(
    readonly locationKind: ObjectStorageDestination["kind"],
    readonly key: string,
  ) {
    super(
      `Cannot reach the object "${key}": it was recorded on a ${locationKind} location ` +
        "this deployment is not configured for.",
    );
    this.name = "UnreachableStorageLocationError";
  }
}

/** A backend no remote reader can reach by URL, such as a local directory. */
export class UnsignableDownloadError extends Error {
  constructor(
    readonly locationKind: ObjectStorageDestination["kind"],
    readonly key: string,
  ) {
    super(
      `Cannot sign a download URL for "${key}": ${locationKind} storage has no URL a remote ` +
        "reader can fetch. Configure S3 or Azure storage to hand objects to another service.",
    );
    this.name = "UnsignableDownloadError";
  }
}

/** No object is stored at this address. */
export class StoredObjectNotFoundError extends Error {
  constructor(
    readonly projectId: string,
    readonly key: string,
  ) {
    super(`No object is stored at "${key}" for project "${projectId}".`);
    this.name = "StoredObjectNotFoundError";
  }
}

/** A body that kept going past the length its writer declared; nothing was kept. */
export class ObjectBodyTooLargeError extends Error {
  constructor(
    readonly key: string,
    readonly declaredBytes: number,
  ) {
    super(`The body written to "${key}" is longer than the ${declaredBytes} bytes declared.`);
    this.name = "ObjectBodyTooLargeError";
  }
}

/** A body that ended before the length its writer declared; nothing was kept. */
export class ObjectBodyShortError extends Error {
  constructor(
    readonly key: string,
    readonly declaredBytes: number,
    readonly receivedBytes: number,
  ) {
    super(
      `The body written to "${key}" ended after ${receivedBytes} of the ${declaredBytes} bytes declared.`,
    );
    this.name = "ObjectBodyShortError";
  }
}

/** A body passing through: counted and hashed chunk by chunk, refused past its declared length. */
export interface MeasuredBody {
  readonly chunks: AsyncIterable<Uint8Array>;
  /** The refusal the body raised, which a transport may have wrapped in its own error. */
  failure(): Error | undefined;
  /** Size and SHA-256 of what passed, once the body has been read to its end. */
  digest(): ObjectDigest;
}

export function measureBody(options: {
  at: StoredObjectAddress;
  body: AsyncIterable<Uint8Array>;
  facts: ObjectBodyFacts;
}): MeasuredBody {
  const { at, body, facts } = options;
  const declared = facts.byteLength;
  if (!Number.isSafeInteger(declared) || declared < 0) {
    throw new RangeError(
      `A body's declared length must be a whole number of bytes, got ${declared}.`,
    );
  }

  const hash = createHash("sha256");
  let received = 0;
  let refusal: Error | undefined;
  let sha256: string | undefined;

  async function* chunks(): AsyncGenerator<Uint8Array> {
    for await (const chunk of body) {
      received += chunk.byteLength;
      if (received > declared) {
        refusal = new ObjectBodyTooLargeError(at.key, declared);
        throw refusal;
      }
      hash.update(chunk);
      yield chunk;
    }
    if (received < declared) {
      refusal = new ObjectBodyShortError(at.key, declared, received);
      throw refusal;
    }
  }

  return {
    chunks: chunks(),
    failure: () => refusal,
    digest() {
      sha256 ??= hash.digest("hex");
      return { byteLength: received, sha256 };
    },
  };
}

/** Reads a stream to its end through the hash, holding one chunk at a time. */
export async function digestOf(stream: AsyncIterable<Uint8Array>): Promise<ObjectDigest> {
  const hash = createHash("sha256");
  let byteLength = 0;
  for await (const chunk of stream) {
    byteLength += chunk.byteLength;
    hash.update(chunk);
  }
  return { byteLength, sha256: hash.digest("hex") };
}

/** Seconds until a signed URL lapses; one that has already lapsed is refused, never signed. */
export function secondsUntil(options: { expiresAt: Instant; now: Instant }): number {
  const seconds = Math.ceil(options.now.until(options.expiresAt).total("seconds"));
  if (seconds <= 0) {
    throw new RangeError("A URL cannot be signed to expire in the past.");
  }
  return seconds;
}
