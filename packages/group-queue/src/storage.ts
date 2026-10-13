import type { Readable } from "node:stream";

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

/** Mints the durable-store uri for one object; the destination type belongs to the caller. */
export type MintStorageUri<Destination = unknown> = (input: {
  destination: Destination;
  tenantId: TenantId;
  key: string;
}) => string;

export interface ObjectStore {
  put(uri: string, bytes: Buffer, mediaType: string): Promise<void>;
  get(uri: string): Promise<Readable>;
}

export function redactStorageUrisInText(text: string): string {
  return text.replace(/\b(?:s3|azure-blob|gs|file):\/\/[^\s'"]+/gi, "<redacted-uri>");
}
