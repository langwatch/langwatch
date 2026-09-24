import type { Readable } from "node:stream";

import type { ObjectDigest, SignedObjectUpload } from "@langwatch/process-stores/members";
import type {
  StoredObjectByteStream,
  StoredObjectDeliveryAudience,
  StoredObjectDeliveryCapability,
  StoredObjectFileRow,
  StoredObjectId,
  StoredObjectProjectId,
  StoredObjectStorageDestination,
} from "@langwatch/stored-object-contract";
import type { Instant } from "@langwatch/time";

/** A probe's answer before the purpose decides the gate and is dropped. */
export type StoredObjectProbe =
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "available" | "missing"; mediaType: string; purpose: string }>;

/** The contract's byte read, narrowed to the Node stream this process's byte backends hand over. */
export type StoredObjectFileStreamRead =
  | { row: StoredObjectFileRow; stream: Readable }
  | { row: StoredObjectFileRow; status: "missing" };

/** The legacy index's reads the byte surface and the probe perform (ADR-158 §5). */
export interface StoredObjectFileReader {
  headById(input: Readonly<{ projectId: string; id: string }>): Promise<StoredObjectProbe>;
  /** Throws `StoredObjectNotFoundError` when the project holds no such row. */
  getById(input: Readonly<{ projectId: string; id: string }>): Promise<StoredObjectFileStreamRead>;
}

export type StoredObjectOwnerLookupSpan = Readonly<{
  setAttribute(name: string, value: string | number | boolean): void;
}>;

/**
 * Process observability stays at composition while the Stored Object owner
 * lookup records its fixed database-operation attributes through this seam.
 */
export interface StoredObjectOwnerLookupTelemetry {
  withLookupSpan<Result>(
    input: { id: string },
    operation: (span: StoredObjectOwnerLookupSpan) => Promise<Result>,
  ): Promise<Result>;
}

/**
 * S3 connection details for one project; separate from bucket selection.
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
export interface StoredObjectS3TargetResolver {
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

/** Where a new object's bytes go, and the largest single PUT that backend takes. */
export type StoredObjectPlacement = Readonly<{
  address: StoredObjectStorageAddress;
  maxSinglePutBytes: number;
}>;

/** The objectStorage member, spoken in the addresses a stored-object row records. */
export abstract class StoredObjectStorage {
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

export abstract class StoredObjectDelivery {
  abstract mint(input: {
    projectId: StoredObjectProjectId;
    id: StoredObjectId;
    audience: StoredObjectDeliveryAudience;
    generation: number;
  }): Promise<StoredObjectDeliveryCapability>;
}
