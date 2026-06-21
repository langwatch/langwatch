/**
 * ADR-032: local-filesystem implementation of `DatasetStorage`.
 *
 * The single-replica self-host fallback (formerly the
 * `env.DATASET_STORAGE_LOCAL` branch). Chunk objects become files under
 * `<root>/<chunk key>`; a missing chunk that PG's `chunkCount` claims throws
 * (never silently truncate). There is no browser-reachable presign for local
 * FS, so `createPresignedUpload` throws `DirectUploadUnavailableError` and the
 * caller falls back to the backend upload path.
 *
 * The `root` is supplied by `getDatasetStorage` from the shared storage
 * destination resolver (`resolveProjectStorageDestination`), which is the single
 * source of truth for where a project's bytes live (it already honors
 * `LANGWATCH_LOCAL_STORAGE_PATH` + the canonical default). This impl never reads
 * `process.env` directly — that would bypass the resolver and risk drifting from
 * the canonical root.
 */

import type { Readable } from "node:stream";
import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";
import {
  assertKeyWithinProject,
  assertNoTraversal,
  CHUNK_MAX_BYTES,
  type ChunkOffset,
  chunkKey,
  type DatasetChunk,
  errorHasProp,
  parseJsonl,
  toJsonlChunks,
  toSingleJsonl,
} from "./dataset-chunking";
import type { DatasetStorage, PresignedUpload } from "./dataset-storage";
import {
  ChunkTooLargeError,
  DirectUploadUnavailableError,
  MissingChunkError,
  StagedUploadNotFoundError,
} from "./errors";

export class LocalDatasetStorage implements DatasetStorage {
  /**
   * The local filesystem root for this project's chunk/staging objects, threaded
   * in from the resolver via `getDatasetStorage` (not read from env here).
   */
  constructor(private readonly root: string) {}

  /** Absolute on-disk path for a storage key under the resolver-provided root. */
  private localPath(key: string): string {
    return path.join(this.root, key);
  }

  async writeChunks({
    projectId,
    datasetId,
    records,
    fromIndex = 0,
    maxBytes,
  }: {
    projectId: string;
    datasetId: string;
    records: unknown[];
    fromIndex?: number;
    maxBytes?: number;
  }): Promise<DatasetChunk[]> {
    assertNoTraversal(projectId, datasetId);
    const chunks = toJsonlChunks(records, maxBytes ? { maxBytes } : {}).map(
      (c) => ({ ...c, index: c.index + fromIndex }),
    );
    for (const chunk of chunks) {
      const filePath = this.localPath(
        chunkKey(projectId, datasetId, chunk.index),
      );
      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, chunk.jsonl, "utf-8");
      } catch (error: unknown) {
        // Born-on-storage requires a writable backend. An unwritable local-FS
        // root (e.g. the default `/var/lib/langwatch/objects` on an install
        // that never provisioned it) would otherwise surface as a cryptic
        // EACCES/EROFS 500 on every dataset write — turn it into an actionable
        // error pointing at the two ways to fix it.
        if (
          errorHasProp(error, "code", "EACCES") ||
          errorHasProp(error, "code", "EROFS") ||
          errorHasProp(error, "code", "EPERM")
        ) {
          throw new Error(
            `Dataset storage path "${this.root}" is not writable. ` +
              "Configure object storage (set S3_BUCKET_NAME) or point " +
              "LANGWATCH_LOCAL_STORAGE_PATH at a writable, persistent directory.",
          );
        }
        throw error;
      }
    }
    return chunks;
  }

  async deleteChunksFrom({
    projectId,
    datasetId,
    fromIndex,
  }: {
    projectId: string;
    datasetId: string;
    fromIndex: number;
  }): Promise<void> {
    assertNoTraversal(projectId, datasetId);
    // Chunks are contiguous from 0, so walk upward and stop at the first miss
    // (the first gap) — no fixed cap needed.
    for (let i = fromIndex; ; i++) {
      const filePath = this.localPath(chunkKey(projectId, datasetId, i));
      try {
        await fs.stat(filePath);
      } catch (error: unknown) {
        if (errorHasProp(error, "code", "ENOENT")) {
          return;
        }
        throw error;
      }
      await fs.rm(filePath);
    }
  }

  async readChunks({
    projectId,
    datasetId,
    chunkCount,
  }: {
    projectId: string;
    datasetId: string;
    chunkCount: number;
  }): Promise<unknown[]> {
    assertNoTraversal(projectId, datasetId);
    const rows: unknown[] = [];
    for (let i = 0; i < chunkCount; i++) {
      const key = chunkKey(projectId, datasetId, i);
      let jsonl: string;
      try {
        jsonl = await fs.readFile(this.localPath(key), "utf-8");
      } catch (error: unknown) {
        if (errorHasProp(error, "code", "ENOENT")) {
          throw new MissingChunkError(key);
        }
        throw error;
      }
      // An empty chunk parses to []; never silently skip (m2). The
      // missing-chunk invariant is already enforced by the throw above.
      rows.push(...parseJsonl(jsonl));
    }
    return rows;
  }

  async readChunk({
    projectId,
    datasetId,
    index,
  }: {
    projectId: string;
    datasetId: string;
    index: number;
  }): Promise<unknown[]> {
    assertNoTraversal(projectId, datasetId);
    const key = chunkKey(projectId, datasetId, index);
    let jsonl: string;
    try {
      jsonl = await fs.readFile(this.localPath(key), "utf-8");
    } catch (error: unknown) {
      if (errorHasProp(error, "code", "ENOENT")) {
        throw new MissingChunkError(key);
      }
      throw error;
    }
    return parseJsonl(jsonl);
  }

  async rewriteChunk({
    projectId,
    datasetId,
    index,
    records,
  }: {
    projectId: string;
    datasetId: string;
    index: number;
    records: unknown[];
  }): Promise<ChunkOffset> {
    assertNoTraversal(projectId, datasetId);
    const { jsonl, byteSize } = toSingleJsonl(records);
    // Decision 2: an edit can grow a chunk past the cap (small row → large
    // value). Reject rather than write an oversized object (parity with the S3
    // impl; splitting on rewrite is out of scope for this rung).
    if (byteSize > CHUNK_MAX_BYTES) {
      throw new ChunkTooLargeError({ byteSize, maxBytes: CHUNK_MAX_BYTES });
    }
    const filePath = this.localPath(chunkKey(projectId, datasetId, index));
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, jsonl, "utf-8");
    // startRow/endRow are chunk-LOCAL here; the caller recomputes global offsets.
    return { index, startRow: 0, endRow: records.length, byteSize };
  }

  /**
   * Local FS has no browser-reachable presign target — signal the caller to
   * use the backend upload path instead.
   */
  createPresignedUpload(_params: {
    projectId: string;
  }): Promise<PresignedUpload> {
    return Promise.reject(new DirectUploadUnavailableError());
  }

  async headStagedObjectSize({
    projectId,
    key,
  }: {
    projectId: string;
    key: string;
  }): Promise<number> {
    assertKeyWithinProject(projectId, key);
    try {
      const stat = await fs.stat(this.localPath(key));
      return stat.size;
    } catch (error: unknown) {
      // A never-completed (or already-reaped) upload — distinct from a too-large
      // one (M5).
      if (errorHasProp(error, "code", "ENOENT")) {
        throw new StagedUploadNotFoundError();
      }
      throw error;
    }
  }

  async deleteStaged({
    projectId,
    key,
  }: {
    projectId: string;
    key: string;
  }): Promise<void> {
    assertKeyWithinProject(projectId, key);
    await fs.rm(this.localPath(key), { force: true });
  }

  async streamStaged({
    projectId,
    key,
  }: {
    projectId: string;
    key: string;
  }): Promise<Readable> {
    assertKeyWithinProject(projectId, key);
    const filePath = this.localPath(key);
    try {
      // Stat first so a missing staged upload surfaces a typed error eagerly,
      // rather than as a late stream 'error' the caller has to translate.
      await fs.stat(filePath);
    } catch (error: unknown) {
      if (errorHasProp(error, "code", "ENOENT")) {
        throw new StagedUploadNotFoundError();
      }
      throw error;
    }
    return createReadStream(filePath);
  }
}
