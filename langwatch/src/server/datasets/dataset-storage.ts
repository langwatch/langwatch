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
 * TODO(getApp): register DatasetStorage on AppDependencies when the dataset
 * domain moves onto getApp. Today `DatasetService` is still
 * middleware-constructed and datasets aren't on getApp, so `getDatasetStorage`
 * is the accessor. The impls are plain injectable classes (no module-global
 * singletons beyond a small per-project S3 client memo) precisely so they can
 * be lifted into `App` later with no rewrite.
 */
import type { Readable } from "node:stream";
import { resolveProjectStorageDestination } from "~/server/stored-objects/project-storage-destination";
import type { ChunkOffset, DatasetChunk } from "./dataset-chunking";
import { LocalDatasetStorage } from "./local-dataset-storage";
import { S3DatasetStorage } from "./s3-dataset-storage";

/** A freshly-minted presigned upload target (server-owned staging key). */
export type PresignedUpload = { uploadId: string; key: string; url: string };

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
   * NOTE: a single-row edit can't meaningfully grow a chunk, and delete only
   * shrinks it, so a rewrite never crosses `CHUNK_MAX_BYTES` in practice. If a
   * caller ever rewrote a chunk larger than the cap, it is still written as one
   * object — splitting-on-rewrite is out of scope for this rung.
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
  createPresignedUpload(params: {
    projectId: string;
  }): Promise<PresignedUpload>;

  /** HEAD a staged upload to read its size — finalize size-cap enforcement. */
  headStagedObjectSize(params: {
    projectId: string;
    key: string;
  }): Promise<number>;

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

/**
 * Select the dataset storage backend for a project via the shared storage
 * destination resolver (the same BYOC → global-S3 → local-FS precedence every
 * byte-writing path uses). `kind: "s3"` → `S3DatasetStorage`; `kind: "file"`
 * → `LocalDatasetStorage`. The resolver — not `env.DATASET_STORAGE_LOCAL` — is
 * the single source of truth for where a project's bytes live.
 */
export const getDatasetStorage = async (
  projectId: string,
): Promise<DatasetStorage> => {
  const destination = await resolveProjectStorageDestination(projectId);
  return destination.kind === "s3"
    ? new S3DatasetStorage()
    : new LocalDatasetStorage();
};
