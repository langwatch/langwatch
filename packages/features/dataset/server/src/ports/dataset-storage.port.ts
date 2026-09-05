/**
 * ADR-032: dataset object storage as a provider-pluggable service (DIP).
 * touching callers. This realizes ADR-032 R1 (S3 JSONL chunks) and R3
 */
import type { Readable } from "node:stream";
import type { S3Client } from "@aws-sdk/client-s3";
import type { ChunkOffset, DatasetChunk } from "../rules/dataset-chunking.rules";

/** A freshly-minted presigned upload target (server-owned staging key). */
export type PresignedUpload = { uploadId: string; key: string; url: string };

export type DatasetS3Client = { s3Client: S3Client; s3Bucket: string };

/** A per-operation S3 client lease. Callers release it once their I/O has settled. */
export type DatasetS3ClientLease = DatasetS3Client & { release(): void };

export abstract class DatasetS3ClientResolver {
  /**
   * Resolves the current tenant target and acquires its process-owned client
   * for one storage operation. The release makes a target change safe while
   * an earlier operation is still using the superseded client.
   */
  abstract acquire(projectId: string): Promise<DatasetS3ClientLease>;
}

export interface DatasetBlobDriver {
  put(uri: string, body: Buffer, contentType?: string): Promise<void>;
  get(uri: string): Promise<Readable>;
  head(uri: string): Promise<number>;
  exists(uri: string): Promise<boolean>;
  delete(uri: string): Promise<void>;
}

export type DatasetAzureConfig = {
  driver: DatasetBlobDriver;
  accountName: string;
  container: string;
};

export abstract class DatasetAzureConfigResolver {
  abstract resolve(projectId: string): Promise<DatasetAzureConfig>;
}

/**
 * Provider-pluggable I/O surface for dataset content. Implementations own only the boundary (S3
 * / filesystem); chunk boundaries, counts and the key scheme are shared pure helpers. Named
 * object params throughout (repo convention).
 */
export interface DatasetStorage {
  /**
   * Write a record set as chunked JSONL starting at `fromIndex` (0 for a
   * fresh dataset, `chunkCount` to append) and return the metadata for the
   * chunks just written. Append never rewrites existing chunk objects.
   */
  writeChunks(params: {
    projectId: string;
    datasetId: string;
    records: unknown[];
    fromIndex?: number;
    maxBytes?: number;
  }): Promise<DatasetChunk[]>;

  /**
   * Read all rows of a dataset back from its chunk objects, in order. Driven by the
   * PG-authoritative `chunkCount` (not S3 LIST).
   */
  readChunks(params: {
    projectId: string;
    datasetId: string;
    chunkCount: number;
  }): Promise<unknown[]>;

  /**
   * Read a single chunk object's rows (ADR-032 Decision 3 — edit/delete locate
   */
  readChunk(params: { projectId: string; datasetId: string; index: number }): Promise<unknown[]>;

  /**
   * Overwrite `chunk-{index}.jsonl` with exactly these records as a single
   * object (ADR-032 Decision 3 — edit/delete rewrite one chunk in place under
   */
  rewriteChunk(params: {
    projectId: string;
    datasetId: string;
    index: number;
    records: unknown[];
  }): Promise<ChunkOffset>;

  /**
   * Mint a presigned upload for a heavy browser→storage direct upload. The key is
   * server-generated and tenant-scoped. Backends without a browser-reachable presign (local FS)
   * throw `DirectUploadUnavailableError` so the caller falls back to the backend upload path.
   */
  createPresignedUpload(params: { projectId: string }): Promise<PresignedUpload>;

  /**
   * Deposit a staged upload from a byte stream, server-side. Present ONLY on backends whose
   * direct upload routes the file THROUGH the app (local FS): the same-origin
   * `/direct-upload/staging/:uploadId` route calls this.
   */
  putStaged?(params: {
    projectId: string;
    key: string;
    body: Readable;
    maxBytes?: number;
  }): Promise<void>;

  /** HEAD a staged upload to read its size — finalize size-cap enforcement. */
  headStagedObjectSize(params: { projectId: string; key: string }): Promise<number>;

  /**
   * Open a backpressured read stream over a staged upload — the normalize job's source (stream
   * → record transform → chunk-writer, never an in-memory array). Throws
   * `StagedUploadNotFoundError` when the staged object is missing.
   */
  streamStaged(params: { projectId: string; key: string }): Promise<Readable>;

  /** Best-effort delete of a staged upload (e.g. after a finalize rejection). */
  deleteStaged(params: { projectId: string; key: string }): Promise<void>;

  /**
   * Delete orphan chunk objects left by a longer prior run (I-IDEM). Chunks are contiguous from
   * index 0, so a re-drive that wrote fewer chunks than a crashed run leaves
   * `chunk-{finalCount}`…`chunk-{prevCount-1}` orphaned.
   */
  deleteChunksFrom(params: {
    projectId: string;
    datasetId: string;
    fromIndex: number;
  }): Promise<void>;
}

/** Runtime-selected storage. The app supplies this once during composition. */
export abstract class DatasetStorageResolver {
  abstract forProject(projectId: string): Promise<DatasetStorage>;
}
