import type { StoredObjectDeliveryAudience } from "./audiences";
import type { StoredObjectId, StoredObjectProjectId } from "./ids";
import type {
  StoredObjectMetadata,
  StoredObjectProvenance,
  StoredObjectStorageUsage,
} from "./metadata";
import type { StoredObjectReference } from "./references";
import type {
  StoredObjectsConfirmUploadInput,
  StoredObjectsCreateUploadInput,
  StoredObjectsCreateUploadOutput,
} from "./uploads";
import type {
  StoredObjectsDeleteInput,
  StoredObjectsDeleteOutput,
  StoredObjectsGetInput,
  StoredObjectsGetOutput,
} from "./stored-object.commands";

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

export interface DeleteProjectStoredObjectsResult {
  projectId: StoredObjectProjectId;
  deletedObjectCount: number;
  deletedByteLength: number;
  status: "completed";
}

/**
 * Complete capability supplied as `app.storedObjects`. Transport
 * adapters deliberately expose only their own smaller RPC contracts.
 */
export abstract class StoredObjectService {
  abstract storeFromBytes(
    input: StoreStoredObjectFromBytesInput,
  ): Promise<StoreStoredObjectFromBytesResult>;

  abstract createUpload(
    input: CreateStoredObjectUploadInput,
  ): Promise<StoredObjectsCreateUploadOutput>;

  abstract confirmUpload(
    input: ConfirmStoredObjectUploadInput,
  ): Promise<StoredObjectReference>;

  abstract getMetadata(input: {
    projectId: StoredObjectProjectId;
    id: StoredObjectId;
  }): Promise<StoredObjectMetadata>;

  abstract getById(input: {
    projectId: StoredObjectProjectId;
    id: StoredObjectId;
  }): Promise<ReadStoredObjectResult>;

  abstract resolveDelivery(input: StoredObjectsGetInput): Promise<StoredObjectsGetOutput>;

  abstract streamForDelivery(input: {
    projectId: StoredObjectProjectId;
    id: StoredObjectId;
    audience: StoredObjectDeliveryAudience;
    generation: number;
    method: "GET" | "HEAD";
  }): Promise<ReadStoredObjectResult>;

  abstract delete(input: DeleteStoredObjectInput): Promise<StoredObjectsDeleteOutput>;

  abstract getStorageUsageByProject(input: {
    projectId: StoredObjectProjectId;
    purpose?: string;
  }): Promise<StoredObjectStorageUsage>;

  abstract deleteOwnedBy(input: {
    projectId: StoredObjectProjectId;
  }): Promise<DeleteProjectStoredObjectsResult>;
}
