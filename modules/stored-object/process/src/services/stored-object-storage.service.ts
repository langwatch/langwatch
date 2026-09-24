import { generate } from "@langwatch/ksuid";
import type {
  ObjectDigest,
  ObjectStorage,
  ObjectStorageDestination,
  SignedObjectUpload,
  StoredObjectAddress,
} from "@langwatch/process-stores/members";
import type {
  StoredObjectByteStream,
  StoredObjectStorageDestination,
} from "@langwatch/stored-object-contract";
import type { Instant } from "@langwatch/time";

import {
  StoredObjectStorage,
  type StoredObjectPlacement,
  type StoredObjectStorageAddress,
} from "../app/stored-object.members.ts";

/** Azure Put Blob's single-request ceiling; there are no block uploads (ADR-158 §3). */
const AZURE_PUT_BLOB_MAX_BYTES = 5000 * 1024 * 1024;

/** The recorded address of an object the process's `objectStorage` member holds. */
export class StoredObjectStorageService extends StoredObjectStorage {
  static create(input: { objectStorage: ObjectStorage }): StoredObjectStorageService {
    return new StoredObjectStorageService(input.objectStorage);
  }

  private constructor(private readonly objects: ObjectStorage) {
    super();
  }

  async place(input: { projectId: string; objectId: string }): Promise<StoredObjectPlacement> {
    const destination = await this.objects.destination(input.projectId);
    const address = addressFor(destination, `${input.projectId}/${input.objectId}`);
    assertProjectAddress(input.projectId, address);
    return {
      address,
      maxSinglePutBytes:
        destination.kind === "azure" ? AZURE_PUT_BLOB_MAX_BYTES : Number.MAX_SAFE_INTEGER,
    };
  }

  async write(input: {
    projectId: string;
    address: StoredObjectStorageAddress;
    body: StoredObjectByteStream;
    byteLength: number;
    mediaType: string;
  }): Promise<ObjectDigest> {
    return this.objects.write(memberAddressOf(input.projectId, input.address), input.body, {
      byteLength: input.byteLength,
      contentType: input.mediaType,
    });
  }

  async signUpload(input: {
    projectId: string;
    address: StoredObjectStorageAddress;
    byteLength: number;
    mediaType: string;
    expiresAt: Instant;
  }): Promise<SignedObjectUpload> {
    return this.objects.signUpload(memberAddressOf(input.projectId, input.address), {
      byteLength: input.byteLength,
      contentType: input.mediaType,
      expiresAt: input.expiresAt,
    });
  }

  async tryStat(input: {
    projectId: string;
    address: StoredObjectStorageAddress;
  }): Promise<ObjectDigest | null> {
    try {
      return await this.objects.digest(memberAddressOf(input.projectId, input.address));
    } catch (error) {
      if (isAbsent(error)) return null;
      throw error;
    }
  }

  async tryRead(input: {
    projectId: string;
    address: StoredObjectStorageAddress;
  }): Promise<StoredObjectByteStream | null> {
    try {
      return await this.objects.read(memberAddressOf(input.projectId, input.address));
    } catch (error) {
      if (isAbsent(error)) return null;
      throw error;
    }
  }

  async delete(input: { projectId: string; address: StoredObjectStorageAddress }): Promise<void> {
    await this.objects.remove(memberAddressOf(input.projectId, input.address));
  }

  async resolveDestination(input: { projectId: string }): Promise<StoredObjectStorageDestination> {
    const destination = await this.objects.destination(input.projectId);
    if (destination.kind === "memory") {
      throw new Error("In-memory object storage has no destination a checkup can name.");
    }
    return destination;
  }

  async probe(input: { projectId: string }): Promise<void> {
    const key = `${input.projectId}/checkup/${generate("stored-object").toString()}.txt`;
    const body = new TextEncoder().encode("checkup");
    await this.objects.write({ projectId: input.projectId, key }, bodyOf(body), {
      byteLength: body.byteLength,
      contentType: "text/plain",
    });
    await this.objects.remove({ projectId: input.projectId, key });
  }
}

/** The member refuses an absent object with its own `StoredObjectNotFoundError`. */
function isAbsent(error: unknown): boolean {
  return error instanceof Error && error.name === "StoredObjectNotFoundError";
}

function assertProjectAddress(projectId: string, address: StoredObjectStorageAddress): void {
  if (!isProvider(address.provider) || !isSafeSegment(address.destinationId, address.provider)) {
    throw new Error("Stored object address has an invalid provider destination");
  }
  const segments = address.relativeId.split("/");
  const isOutsideRequestedProject =
    segments.length < 2 ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("%") ||
        /[^\P{Cc}\u007f-\u009f]|[?#]/u.test(segment),
    ) ||
    address.relativeId.includes("\\") ||
    segments[0] !== projectId;

  if (isOutsideRequestedProject) {
    throw new Error("Stored object address is outside the requested project");
  }
}

/** The member's address for a recorded one: read, digest and remove go where it was recorded. */
function memberAddressOf(
  projectId: string,
  address: StoredObjectStorageAddress,
): StoredObjectAddress {
  assertProjectAddress(projectId, address);
  return { projectId, key: address.relativeId, location: locationOf(address) };
}

function locationOf(address: StoredObjectStorageAddress): ObjectStorageDestination {
  if (address.provider === "s3") return { kind: "s3", bucket: address.destinationId };
  if (address.provider === "file") return { kind: "file", root: address.destinationId };
  if (address.provider === "memory") return { kind: "memory" };
  const [accountName = "", container = ""] = address.destinationId.split("/");

  return { kind: "azure", accountName, container };
}

function isProvider(value: string): value is "s3" | "file" | "azure-blob" | "memory" {
  return value === "s3" || value === "file" || value === "azure-blob" || value === "memory";
}

function isSafeSegment(value: string, provider: string): boolean {
  const hasUnsafeCharacters =
    !value ||
    value.includes("\\") ||
    value.includes("%") ||
    /[^\P{Cc}\u007f-\u009f]|[?#]/u.test(value);

  if (hasUnsafeCharacters) {
    return false;
  }
  if (provider === "s3" || provider === "memory") return !value.includes("/");
  if (provider === "file") return !value.includes("//");
  const segments = value.split("/");
  return segments.length === 2 && segments.every((segment) => Boolean(segment));
}

function destinationIdFor(destination: ObjectStorageDestination): string {
  if (destination.kind === "s3") return destination.bucket;
  if (destination.kind === "file") return destination.root;
  if (destination.kind === "memory") return "memory";

  return `${destination.accountName}/${destination.container}`;
}

function addressFor(
  destination: ObjectStorageDestination,
  relativeId: string,
): StoredObjectStorageAddress {
  return {
    provider: destination.kind === "azure" ? "azure-blob" : destination.kind,
    destinationId: destinationIdFor(destination),
    relativeId,
  };
}

async function* bodyOf(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}
