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
import { resolveProjectStorageDestination } from "~/server/stored-objects/project-storage-destination";
import type { DatasetChunk } from "./dataset-chunking";
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
   * Mint a presigned upload for a heavy browser→storage direct upload. The
   * key is server-generated and tenant-scoped. Backends without a
   * browser-reachable presign (local FS) throw `DirectUploadUnavailableError`
   * so the caller falls back to the backend upload path.
   */
  createPresignedUpload(params: { projectId: string }): Promise<PresignedUpload>;

  /** HEAD a staged upload to read its size — finalize size-cap enforcement. */
  headStagedObjectSize(params: {
    projectId: string;
    key: string;
  }): Promise<number>;

  /** Best-effort delete of a staged upload (e.g. after a finalize rejection). */
  deleteStaged(params: { projectId: string; key: string }): Promise<void>;
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
