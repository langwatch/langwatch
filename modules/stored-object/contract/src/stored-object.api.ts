import { featureApi } from "@langwatch/runtime-composition";
import type { StoredObjectDeliveryAudience } from "./audiences.ts";
import type { StoredObjectId, StoredObjectProjectId } from "./ids.ts";
import type {
  StoredObjectMetadata,
  StoredObjectProvenance,
  StoredObjectStorageUsage,
} from "./metadata.ts";
import type { StoredObjectReference } from "./references.ts";
import type {
  StoredObjectsConfirmUploadInput,
  StoredObjectsCreateUploadInput,
  StoredObjectsCreateUploadOutput,
} from "./uploads.ts";
import type {
  StoredObjectsDeleteInput,
  StoredObjectsDeleteOutput,
  StoredObjectsGetInput,
  StoredObjectsGetOutput,
} from "./stored-object.commands.ts";
import type { StoredObjectHead } from "./stored-object.trpc.ts";

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
  headById(input: { projectId: string; id: string }): Promise<StoredObjectHead>;
  readById(input: { projectId: string; id: string }): Promise<StoredObjectFileRead | null>;
  resolveOwner(input: { id: string }): Promise<{ projectId: string } | null>;
}

export const StoredObjectApi = featureApi<StoredObjectApi>("stored-object");
