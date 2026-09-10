import type {
  StoredObjectByteStream,
  StoredObjectDeliveryAudience,
  StoredObjectDeliveryCapability,
  StoredObjectDirectUploadTarget,
  StoredObjectId,
  StoredObjectOperationId,
  StoredObjectProjectId,
  StoredObjectReference,
} from "@langwatch/stored-object-contract";
import type { Instant } from "@langwatch/time";

export type StoredObjectOwnerLookupSpan = Readonly<{
  setAttribute(name: string, value: string | number | boolean): void;
}>;

/**
 * Process observability stays at composition while the Stored Object owner
 * lookup records its fixed database-operation attributes through this port.
 */
export interface StoredObjectOwnerLookupTelemetry {
  withLookupSpan<Result>(
    input: { id: string },
    operation: (span: StoredObjectOwnerLookupSpan) => Promise<Result>,
  ): Promise<Result>;
}

/**
 * Where one project's S3 bytes actually go: the endpoint, region and
 * credentials its objects are written and read through.
 *
 * Separate from {@link StoredObjectProjectS3ConfigPort}, which answers only
 * the BUCKET a destination is minted against. This one answers the CONNECTION,
 * and the two are different questions: a BYOC tenant's bucket lives on the
 * tenant's own endpoint with the tenant's own credentials, and a URI minted
 * against that bucket is unreadable through the deployment's shared client.
 */
export type StoredObjectS3Credentials = Readonly<{
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}>;

export type StoredObjectS3Target = Readonly<{
  endpoint?: string;
  region?: string;
  credentials?: StoredObjectS3Credentials;
}>;

/** Resolves the S3 connection one project's objects are reached through. */
export interface StoredObjectS3TargetPort {
  resolve(projectId: string): Promise<StoredObjectS3Target>;
}

/** The three operations the stored-object table needs, as the driver exposes them. */
export type StoredObjectsClickHouseClient = Readonly<{
  insert(input: {
    table: string;
    values: readonly Record<string, unknown>[];
    format: "JSONEachRow";
    clickhouse_settings?: Record<string, unknown>;
  }): Promise<unknown>;
  query(input: {
    query: string;
    query_params: Record<string, unknown>;
    format: "JSONEachRow";
  }): Promise<{ json<Result>(): Promise<Result[]> }>;
  exec(input: {
    query: string;
    query_params: Record<string, unknown>;
    clickhouse_settings?: Record<string, unknown>;
  }): Promise<unknown>;
}>;

/** Resolves the client one project's stored-object rows live on. */
export interface StoredObjectsClickHouse {
  resolveClient(projectId: string): Promise<StoredObjectsClickHouseClient>;
}

/**
 * What the content-addressed store reports about its own work.
 */
export interface StoredObjectsTelemetry {
  /** One `storeFromBytes` call arrived, whatever it went on to do. */
  recordExtract(purpose: string): void;
  /** The content was already held for this project, so nothing was written. */
  recordDedupHit(purpose: string): void;
  /** The storage backend refused a write, or the row insert after it failed. */
  recordWriteFailure(purpose: string): void;
  /** A read reached the storage backend and it failed for anything but a 404. */
  recordReadFailure(): void;
  /** The payload size one call carried. */
  observeSizeBytes(purpose: string, bytes: number): void;
}

export type StoredObjectStorageAddress = Readonly<{
  provider: string;
  destinationId: string;
  relativeId: string;
}>;

export type StoredObjectUploadTokenClaims = Readonly<{
  projectId: StoredObjectProjectId;
  objectId: StoredObjectId;
  operationId: StoredObjectOperationId;
  address: StoredObjectStorageAddress;
  reference: StoredObjectReference;
  expiresAt: string;
}>;

/** Existing application storage drivers are adapted to this narrow boundary. */
export abstract class StoredObjectStoragePort {
  abstract write(input: {
    projectId: StoredObjectProjectId;
    objectId: StoredObjectId;
    bytes: Uint8Array;
    mediaType: string;
  }): Promise<StoredObjectStorageAddress>;

  abstract tryCreateUpload(input: {
    projectId: StoredObjectProjectId;
    objectId: StoredObjectId;
    byteLength: number;
    sha256: string;
    mediaType: string;
    expiresAt: Instant;
  }): Promise<{
    address: StoredObjectStorageAddress;
    target: StoredObjectDirectUploadTarget;
  } | null>;

  abstract tryStat(input: {
    projectId: StoredObjectProjectId;
    address: StoredObjectStorageAddress;
  }): Promise<{ byteLength: number; sha256: string } | null>;

  abstract tryRead(input: {
    projectId: StoredObjectProjectId;
    address: StoredObjectStorageAddress;
  }): Promise<StoredObjectByteStream | null>;

  abstract delete(input: {
    projectId: StoredObjectProjectId;
    address: StoredObjectStorageAddress;
  }): Promise<void>;
}

export abstract class StoredObjectUploadTokenPort {
  abstract encode(claims: StoredObjectUploadTokenClaims): Promise<string>;
  abstract decode(token: string): Promise<StoredObjectUploadTokenClaims>;
}

export abstract class StoredObjectDeliveryPort {
  abstract mint(input: {
    projectId: StoredObjectProjectId;
    id: StoredObjectId;
    audience: StoredObjectDeliveryAudience;
    generation: number;
  }): Promise<StoredObjectDeliveryCapability>;
}
