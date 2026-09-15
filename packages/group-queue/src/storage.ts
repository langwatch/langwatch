import type { Readable } from "node:stream";
import {
  mintStoredObjectUri,
  type StoredObjectStorageDestination,
} from "@langwatch/stored-object-contract";

export type TenantId = string;

export function createTenantId(value: string): TenantId {
  const tenantId = value.trim();
  if (tenantId.length === 0) {
    throw new Error("Tenant id must be a non-empty string");
  }
  return tenantId;
}

export function tenantIdFromGroupId(groupId: string): string | null {
  const separator = groupId.indexOf("/");
  return separator > 0 ? groupId.slice(0, separator) : null;
}

export type ProjectStorageDestination = StoredObjectStorageDestination;

export interface ObjectStore {
  put(uri: string, bytes: Buffer, mediaType: string): Promise<void>;
  get(uri: string): Promise<Readable>;
  delete(uri: string): Promise<void>;
}

export function mintUriForDestination({
  destination,
  objectPath,
}: {
  destination: ProjectStorageDestination;
  objectPath: string;
}): string {
  return mintStoredObjectUri({ destination, objectPath });
}

export function redactStorageUrisInText(text: string): string {
  return text.replace(/\b(?:s3|azure-blob|gs|file):\/\/[^\s'"]+/gi, "<redacted-uri>");
}
