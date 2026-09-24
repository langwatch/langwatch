import { moduleApi } from "@langwatch/kernel/module-api";

import type { StoredObjectDeliveryAudience } from "./audiences.ts";
import type { StoredObjectId, StoredObjectProjectId } from "./ids.ts";
import type {
  StoredObjectMetadata,
  StoredObjectProvenance,
  StoredObjectStorageUsage,
} from "./metadata.ts";
import type { StoredObjectReference } from "./references.ts";
import type { StoredObjectStorageDestination } from "./storage-uri.ts";
import type {
  StoredObjectsDeleteInput,
  StoredObjectsDeleteOutput,
  StoredObjectsGetInput,
  StoredObjectsGetOutput,
} from "./stored-object.commands.ts";
import type { StoredObjectHead } from "./stored-object.trpc.ts";
import type {
  StoredObjectsConfirmUploadInput,
  StoredObjectsCreateUploadInput,
  StoredObjectsCreateUploadOutput,
} from "./uploads.ts";

export type StoredObjectByteStream = AsyncIterable<Uint8Array>;
export type StoredObjectByteSource = Uint8Array | StoredObjectByteStream;

export interface StoreStoredObjectFromBytesInput extends StoredObjectProvenance {
  projectId: StoredObjectProjectId;
  filename: string;
  mediaType: string;
  audience: StoredObjectDeliveryAudience;
  bytes: StoredObjectByteSource;
}

export interface StoreStoredObjectFromBytesResult {
  reference: StoredObjectReference;
  isDuplicate: boolean;
}

export interface ReadStoredObjectResult {
  metadata: StoredObjectMetadata;
  bytes: StoredObjectByteStream;
}

export type CreateStoredObjectUploadInput = StoredObjectsCreateUploadInput;

export type ConfirmStoredObjectUploadInput = StoredObjectsConfirmUploadInput;

export type DeleteStoredObjectInput = StoredObjectsDeleteInput;

/** A web stream's reader side, the shape the REST runtime hands a raw request body over in. */
export interface StoredObjectUploadBody {
  getReader(): {
    read(): Promise<{ done: true; value?: Uint8Array } | { done: false; value: Uint8Array }>;
    releaseLock(): void;
  };
}

/** The hidden local route's body, streamed to storage once its seal checks out (ADR-158 §4). */
export interface WriteStoredObjectUploadInput {
  objectId: StoredObjectId;
  signature: string;
  contentLength: number | undefined;
  body: StoredObjectUploadBody | null;
}

/**
 * The row the byte surface builds its response from. `purpose` and `owner_kind`
 * are gates rather than description: the file door picks its permission from
 * the purpose, and the avatar door refuses every other owner kind.
 */
export interface StoredObjectFileRow {
  id: string;
  purpose: string;
  owner_kind: string;
  media_type: string;
  size_bytes: number;
}

/** What a byte read answers with when the row exists but the blob may not. */
export type StoredObjectFileRead =
  | { row: StoredObjectFileRow; stream: StoredObjectByteStream }
  | { row: StoredObjectFileRow; status: "missing" };

export interface DeleteProjectStoredObjectsResult {
  projectId: StoredObjectProjectId;
  deletedObjectCount: number;
  deletedByteLength: number;
  status: "completed";
}

/** The complete process capability exposed by the stored-object feature. */
export interface StoredObjectApi {
  storeFromBytes(input: StoreStoredObjectFromBytesInput): Promise<StoreStoredObjectFromBytesResult>;
  createUpload(input: CreateStoredObjectUploadInput): Promise<StoredObjectsCreateUploadOutput>;
  confirmUpload(input: ConfirmStoredObjectUploadInput): Promise<StoredObjectReference>;
  /** Internal: called only by the hidden local signed route. */
  writeUpload(input: WriteStoredObjectUploadInput): Promise<void>;
  getMetadata(input: {
    projectId: StoredObjectProjectId;
    id: StoredObjectId;
  }): Promise<StoredObjectMetadata>;
  getById(input: {
    projectId: StoredObjectProjectId;
    id: StoredObjectId;
  }): Promise<ReadStoredObjectResult>;
  resolveDelivery(input: StoredObjectsGetInput): Promise<StoredObjectsGetOutput>;
  delete(input: DeleteStoredObjectInput): Promise<StoredObjectsDeleteOutput>;
  getStorageUsageByProject(input: {
    projectId: StoredObjectProjectId;
    purpose?: string;
  }): Promise<StoredObjectStorageUsage>;
  deleteOwnedBy(input: {
    projectId: StoredObjectProjectId;
  }): Promise<DeleteProjectStoredObjectsResult>;
  /**
   * Holds `by` to the permission the object's purpose names; the transport
   * admits any file viewer first.
   */
  headById(
    input: { projectId: string; id: string },
    by: Readonly<{ id: string }>,
  ): Promise<StoredObjectHead>;
  /** Throws `StoredObjectNotFoundError` when the project holds no such row. */
  readById(input: { projectId: string; id: string }): Promise<StoredObjectFileRead>;
  /** Throws `StoredObjectNotFoundError` when no instance holds the id. */
  resolveOwner(input: { id: string }): Promise<{ projectId: string }>;
  /** Where this project's objects are written, for the checkup. */
  getStorageDestination(input: {
    projectId: StoredObjectProjectId;
  }): Promise<StoredObjectStorageDestination>;
  /** Writes a small object where the project's objects go, then removes it; throws on refusal. */
  probeStorage(input: { projectId: StoredObjectProjectId }): Promise<void>;
}

export const StoredObjectApi = moduleApi<StoredObjectApi>()("stored-object");
