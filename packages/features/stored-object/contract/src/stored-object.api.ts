import { featureApi } from "@langwatch/runtime-composition";
import type {
  ConfirmStoredObjectUploadInput,
  CreateStoredObjectUploadInput,
  DeleteProjectStoredObjectsResult,
  DeleteStoredObjectInput,
  ReadStoredObjectResult,
  StoreStoredObjectFromBytesInput,
  StoreStoredObjectFromBytesResult,
} from "./stored-object.service.ts";
import type {
  StoredObjectsDeleteOutput,
  StoredObjectsGetInput,
  StoredObjectsGetOutput,
} from "./stored-object.commands.ts";
import type { StoredObjectMetadata, StoredObjectStorageUsage } from "./metadata.ts";
import type { StoredObjectReference } from "./references.ts";
import type { StoredObjectsCreateUploadOutput } from "./uploads.ts";
import type { StoredObjectHead } from "./stored-object.queries.ts";

/** The complete process capability exposed by the stored-object feature. */
export interface StoredObjectApi {
  storeFromBytes(input: StoreStoredObjectFromBytesInput): Promise<StoreStoredObjectFromBytesResult>;
  createUpload(input: CreateStoredObjectUploadInput): Promise<StoredObjectsCreateUploadOutput>;
  confirmUpload(input: ConfirmStoredObjectUploadInput): Promise<StoredObjectReference>;
  getMetadata(input: { projectId: string; id: string }): Promise<StoredObjectMetadata>;
  getById(input: { projectId: string; id: string }): Promise<ReadStoredObjectResult>;
  resolveDelivery(input: StoredObjectsGetInput): Promise<StoredObjectsGetOutput>;
  delete(input: DeleteStoredObjectInput): Promise<StoredObjectsDeleteOutput>;
  getStorageUsageByProject(input: {
    projectId: string;
    purpose?: string;
  }): Promise<StoredObjectStorageUsage>;
  deleteOwnedBy(input: { projectId: string }): Promise<DeleteProjectStoredObjectsResult>;
  headById(input: { projectId: string; id: string }): Promise<StoredObjectHead>;
  resolveOwner(input: { id: string }): Promise<{ projectId: string } | null>;
}

export const StoredObjectApi = featureApi<StoredObjectApi>("stored-object");
