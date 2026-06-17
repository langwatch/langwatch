/**
 * ADR-032: local-filesystem implementation of `DatasetStorage`.
 *
 * The single-replica self-host fallback (formerly the
 * `env.DATASET_STORAGE_LOCAL` branch). Chunk objects become files under
 * `LOCAL_STORAGE_PATH`/<chunk key>; a missing chunk that PG's `chunkCount`
 * claims throws (never silently truncate). There is no browser-reachable
 * presign for local FS, so `createPresignedUpload` throws
 * `DirectUploadUnavailableError` and the caller falls back to the backend
 * upload path.
 */
import fs from "fs/promises";
import path from "path";
import {
  assertNoTraversal,
  chunkKey,
  type DatasetChunk,
  parseJsonl,
  toJsonlChunks,
} from "./dataset-chunking";
import type { DatasetStorage, PresignedUpload } from "./dataset-storage";
import { DirectUploadUnavailableError } from "./errors";

const errorHasProp = (error: unknown, prop: "code", value: string): boolean =>
  typeof error === "object" &&
  error !== null &&
  prop in error &&
  (error as Record<string, unknown>)[prop] === value;

/** Absolute on-disk path for a storage key under the local root. */
const localPath = (key: string): string => {
  const storageDir =
    process.env.LOCAL_STORAGE_PATH ?? path.resolve(process.cwd(), "storage");
  return path.join(storageDir, key);
};

export class LocalDatasetStorage implements DatasetStorage {
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
      const filePath = localPath(chunkKey(projectId, datasetId, chunk.index));
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, chunk.jsonl, "utf-8");
    }
    return chunks;
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
        jsonl = await fs.readFile(localPath(key), "utf-8");
      } catch (error: unknown) {
        if (errorHasProp(error, "code", "ENOENT")) {
          throw new Error(`Missing dataset chunk: ${key}`);
        }
        throw error;
      }
      if (jsonl) rows.push(...parseJsonl(jsonl));
    }
    return rows;
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
    assertNoTraversal(projectId);
    const stat = await fs.stat(localPath(key));
    return stat.size;
  }

  async deleteStaged({
    projectId,
    key,
  }: {
    projectId: string;
    key: string;
  }): Promise<void> {
    assertNoTraversal(projectId);
    await fs.rm(localPath(key), { force: true });
  }
}
