import type { ObjectDigest, SignedObjectUpload } from "@langwatch/process-stores/members";
import type {
  StoredObjectByteStream,
  StoredObjectId,
  StoredObjectProjectId,
  StoredObjectStorageDestination,
} from "@langwatch/stored-object-contract";
import type { Instant } from "@langwatch/time";

export type StoredObjectStorageAddress = Readonly<{
  provider: string;
  destinationId: string;
  relativeId: string;
}>;

/** Where a new object's bytes go, and the largest single PUT that backend takes. */
export type StoredObjectPlacement = Readonly<{
  address: StoredObjectStorageAddress;
  maxSinglePutBytes: number;
}>;

/** An object's bytes, spoken in the addresses a stored-object row records. */
export abstract class StoredObjectBytesRepository {
  abstract place(input: {
    projectId: StoredObjectProjectId;
    objectId: StoredObjectId;
  }): Promise<StoredObjectPlacement>;

  /** Streams the body to `address`, counting and hashing; refuses past `byteLength`. */
  abstract write(input: {
    projectId: StoredObjectProjectId;
    address: StoredObjectStorageAddress;
    body: StoredObjectByteStream;
    byteLength: number;
    mediaType: string;
  }): Promise<ObjectDigest>;

  abstract signUpload(input: {
    projectId: StoredObjectProjectId;
    address: StoredObjectStorageAddress;
    byteLength: number;
    mediaType: string;
    expiresAt: Instant;
  }): Promise<SignedObjectUpload>;

  /** Throws `StoredObjectNotFoundError` when no bytes are at the address. */
  abstract getStat(input: {
    projectId: StoredObjectProjectId;
    address: StoredObjectStorageAddress;
  }): Promise<ObjectDigest>;

  /** Throws `StoredObjectNotFoundError` when no bytes are at the address. */
  abstract getBytes(input: {
    projectId: StoredObjectProjectId;
    address: StoredObjectStorageAddress;
  }): Promise<StoredObjectByteStream>;

  abstract delete(input: {
    projectId: StoredObjectProjectId;
    address: StoredObjectStorageAddress;
  }): Promise<void>;

  /** Where this project's bytes are written. */
  abstract resolveDestination(input: {
    projectId: StoredObjectProjectId;
  }): Promise<StoredObjectStorageDestination>;

  /** Writes a small object where the project's bytes go, then removes it. */
  abstract probe(input: { projectId: StoredObjectProjectId }): Promise<void>;
}
