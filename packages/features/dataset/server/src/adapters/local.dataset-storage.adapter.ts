/**
 * ADR-032: local-filesystem implementation of `DatasetStorage`.
 * which streams it back here via `putStaged` (ADR-032 D4, local-FS extension).
 */

import { type Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createLogger } from "@langwatch/observability";
import { createReadStream, createWriteStream } from "fs";
import fs from "fs/promises";
import { nanoid } from "nanoid";
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
} from "../rules/dataset-chunking.rules.ts";
import type { DatasetStorage, PresignedUpload } from "../ports/dataset-storage.port.ts";
import {
  ChunkTooLargeError,
  MissingChunkError,
  StagedUploadNotFoundError,
  StorageNotWritableError,
  UploadTooLargeError,
} from "@langwatch/dataset-contract";
import { localStagingUploadPath, stagingUploadKey } from "../rules/presigned-upload.rules.ts";

const logger = createLogger("langwatch:datasets:local-storage");

export class LocalDatasetStorageAdapter implements DatasetStorage {
  static create(root: string): LocalDatasetStorageAdapter {
    return new LocalDatasetStorageAdapter(root);
  }
  /**
   * The local filesystem root for this project's chunk/staging objects, threaded
   * in from the resolver via `getDatasetStorage` (not read from env here).
   */
  constructor(private readonly root: string) {}

  /** Absolute on-disk path for a storage key under the resolver-provided root. */
  private localPath(key: string): string {
    return path.join(this.root, key);
  }

  /**
   * Write a chunk file atomically: write a unique temp sibling, then `rename` it into place.
   */
  private async atomicWriteFile(filePath: string, data: string): Promise<void> {
    const tmpPath = `${filePath}.tmp-${nanoid()}`;
    try {
      await fs.writeFile(tmpPath, data, "utf-8");
      await fs.rename(tmpPath, filePath);
    } catch (error: unknown) {
      await fs.rm(tmpPath, { force: true }).catch(() => {
        // best-effort cleanup — surface the original write/rename error
      });
      throw error;
    }
  }

  /**
   * Turn a raw FS permission failure (EACCES/EROFS/EPERM) into the handled
   * `storage_not_writable` refusal; rethrow anything else.
   */
  private rethrowWritable(error: unknown): never {
    const isWriteAccessError =
      errorHasProp(error, "code", "EACCES") ||
      errorHasProp(error, "code", "EROFS") ||
      errorHasProp(error, "code", "EPERM");
    if (isWriteAccessError) {
      logger.error(
        { root: this.root, error },
        `Dataset storage path "${this.root}" is not writable. Configure object storage (set S3_BUCKET_NAME) or point LANGWATCH_LOCAL_STORAGE_PATH at a writable, persistent directory.`,
      );
      throw new StorageNotWritableError();
    }
    throw error;
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
    const chunks = toJsonlChunks(records, maxBytes ? { maxBytes } : {}).map((c) => ({
      ...c,
      index: c.index + fromIndex,
    }));
    for (const chunk of chunks) {
      const filePath = this.localPath(chunkKey(projectId, datasetId, chunk.index));
      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await this.atomicWriteFile(filePath, chunk.jsonl);
      } catch (error: unknown) {
        this.rethrowWritable(error);
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
    await this.atomicWriteFile(filePath, jsonl);
    // startRow/endRow are chunk-LOCAL here; the caller recomputes global offsets.
    return { index, startRow: 0, endRow: records.length, byteSize };
  }

  /**
   * Local FS has no browser-reachable bucket, so instead of a cross-origin presigned PUT we
   * mint a SAME-ORIGIN upload URL: the browser PUTs the raw file to
   * `/direct-upload/staging/:uploadId`, which streams it back here via `putStaged`.
   */
  createPresignedUpload({ projectId }: { projectId: string }): Promise<PresignedUpload> {
    const uploadId = nanoid();
    return Promise.resolve({
      uploadId,
      key: stagingUploadKey(projectId, uploadId),
      url: localStagingUploadPath(projectId, uploadId),
    });
  }

  /**
   * Stream a staged upload to disk (the server-side deposit for the local-FS direct-upload
   * route). Streamed via `pipeline`, never buffered, so a multi-GB file never sits in heap.
   */
  async putStaged({
    projectId,
    key,
    body,
    maxBytes,
  }: {
    projectId: string;
    key: string;
    body: Readable;
    maxBytes?: number;
  }): Promise<void> {
    assertKeyWithinProject(projectId, key);
    const filePath = this.localPath(key);

    let written = 0;
    const cap = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        written += chunk.length;
        if (maxBytes != null && written > maxBytes) {
          cb(new UploadTooLargeError());
          return;
        }
        cb(null, chunk);
      },
    });

    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await pipeline(body, cap, createWriteStream(filePath));
    } catch (error: unknown) {
      // On any failure (cap exceeded, write error) drop the partial object so a
      // rejected upload never leaves a half-written staged file behind.
      await fs.rm(filePath, { force: true }).catch(() => {
        // best-effort cleanup — surface the original error below
      });
      if (error instanceof UploadTooLargeError) {
        throw error;
      }
      this.rethrowWritable(error);
    }
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

  async deleteStaged({ projectId, key }: { projectId: string; key: string }): Promise<void> {
    assertKeyWithinProject(projectId, key);
    await fs.rm(this.localPath(key), { force: true });
  }

  async streamStaged({ projectId, key }: { projectId: string; key: string }): Promise<Readable> {
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

export const LocalDatasetStorage = LocalDatasetStorageAdapter;
