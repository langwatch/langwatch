/**
 * ADR-032: dataset object storage as a provider-pluggable service (DIP).
 *
 * `DatasetStorage` is the abstraction every dataset-content I/O path depends
 * on; concrete backends (`S3DatasetStorage`, `LocalDatasetStorage`) are
 * dropped in behind it, so local / GCS / MinIO can be added later without
 * touching callers. This realizes ADR-032 R1 (S3 JSONL chunks) and R3
 * (presigned direct upload) as one injectable seam rather than free functions
 * that branch on `env.DATASET_STORAGE_LOCAL` and reach for `createS3Client`.
 *
 * The pure chunk math lives in `dataset-chunking.ts`; presign size/key policy
 * lives in `presigned-upload.ts`. The impls compose those — they never
 * reimplement them.
 *
 * The concrete provider is supplied to the Dataset feature's composition
 * adapter. The accessor remains as a compatibility helper for the existing
 * storage backends until their implementations are relocated beside the
 * feature's storage port.
 */
import type { Readable } from "node:stream";
import type { S3Client } from "@aws-sdk/client-s3";
import type { ChunkOffset, DatasetChunk } from "../services/dataset-chunking";

/** A freshly-minted presigned upload target (server-owned staging key). */
export type PresignedUpload = { uploadId: string; key: string; url: string };

export type DatasetS3Client = { s3Client: S3Client; s3Bucket: string };

export abstract class DatasetS3ClientResolver {
  abstract resolve(projectId: string): Promise<DatasetS3Client>;
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
 * Provider-pluggable I/O surface for dataset content. Implementations own
 * only the boundary (S3 / filesystem); chunk boundaries, counts and the key
 * scheme are shared pure helpers. Named object params throughout (repo
 * convention).
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
   * Read all rows of a dataset back from its chunk objects, in order.
   * Driven by the PG-authoritative `chunkCount` (not S3 LIST). A chunk that
   * `chunkCount` claims must exist but is missing is corruption, not
   * emptiness — implementations throw rather than silently truncate.
   */
  readChunks(params: {
    projectId: string;
    datasetId: string;
    chunkCount: number;
  }): Promise<unknown[]>;

  /**
   * Read a single chunk object's rows (ADR-032 Decision 3 — edit/delete locate
   * and rewrite only the affected chunk, so they read just that chunk rather
   * than the whole dataset). Throws on a missing chunk, consistent with
   * `readChunks` (a chunk `chunkCount` claims exists but is missing is
   * corruption, not emptiness — never silently truncate).
   */
  readChunk(params: {
    projectId: string;
    datasetId: string;
    index: number;
  }): Promise<unknown[]>;

  /**
   * Overwrite `chunk-{index}.jsonl` with exactly these records as a single
   * object (ADR-032 Decision 3 — edit/delete rewrite one chunk in place under
   * the advisory lock). Returns the new offset/byteSize for that index so the
   * caller can patch the PG-authoritative `chunkOffsets` entry (I-COUNT). The
   * same null-byte scrub (I-NULL) and key guard the append path uses apply.
   *
   * NOTE: an edit CAN grow a chunk past `CHUNK_MAX_BYTES` — replacing a small
   * row with a large value enlarges the chunk (only delete strictly shrinks).
   * Implementations REJECT a rewrite whose serialized size exceeds the cap
   * (`ChunkTooLargeError`) rather than writing an oversized object; splitting /
   * rebalancing the chunk on rewrite is the fuller fix, deferred to a later rung.
   */
  rewriteChunk(params: {
    projectId: string;
    datasetId: string;
    index: number;
    records: unknown[];
  }): Promise<ChunkOffset>;

  /**
   * Mint a presigned upload for a heavy browser→storage direct upload. The
   * key is server-generated and tenant-scoped. Backends without a
   * browser-reachable presign (local FS) throw `DirectUploadUnavailableError`
   * so the caller falls back to the backend upload path.
   */
  createPresignedUpload(params: { projectId: string }): Promise<PresignedUpload>;

  /**
   * Deposit a staged upload from a byte stream, server-side. Present ONLY on
   * backends whose direct upload routes the file THROUGH the app (local FS): the
   * same-origin `/direct-upload/staging/:uploadId` route calls this. S3 omits it
   * — its presigned PUT lands bytes in the bucket directly, so they never transit
   * the app. Streamed, never buffered (multi-GB safe); `maxBytes` aborts a stream
   * that exceeds the cap (and deletes the partial object) so an authed client
   * can't fill the disk before the finalize HEAD would reject it.
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
   * Open a backpressured read stream over a staged upload — the normalize
   * job's source (stream → record transform → chunk-writer, never an in-memory
   * array). Throws `StagedUploadNotFoundError` when the staged object is
   * missing. The key is validated to sit under the project's `staging/` prefix.
   */
  streamStaged(params: { projectId: string; key: string }): Promise<Readable>;

  /** Best-effort delete of a staged upload (e.g. after a finalize rejection). */
  deleteStaged(params: { projectId: string; key: string }): Promise<void>;

  /**
   * Delete orphan chunk objects left by a longer prior run (I-IDEM). Chunks are
   * contiguous from index 0, so a re-drive that wrote fewer chunks than a
   * crashed run leaves `chunk-{finalCount}`…`chunk-{prevCount-1}` orphaned.
   * Delete from `fromIndex` upward, stopping at the first index that does NOT
   * exist (the first contiguous gap) — no fixed cap needed.
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
