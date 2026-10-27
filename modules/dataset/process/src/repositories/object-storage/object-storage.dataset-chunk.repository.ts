/**
 * Dataset chunks over the process's `objectStorage` member, at main's released
 * chunk keys (ADR-158 §1), so chunks written before the move stay readable.
 */
import { ChunkTooLargeError, MissingChunkError } from "@langwatch/dataset-contract";
import type { ObjectStorage, StoredObjectAddress } from "@langwatch/process-stores/members";

import {
  assertKeyWithinProject,
  assertNoTraversal,
  CHUNK_MAX_BYTES,
  chunkKey,
  type ChunkOffset,
  type DatasetChunk,
  parseJsonl,
  toJsonlChunks,
  toSingleJsonl,
} from "../../rules/dataset-chunking.rules.ts";
import type { DatasetChunkRepository } from "../dataset-chunk.repository.ts";

const JSONL_MEDIA_TYPE = "application/x-ndjson";

export class ObjectStorageDatasetChunkRepository implements DatasetChunkRepository {
  static create(input: { objectStorage: ObjectStorage }): ObjectStorageDatasetChunkRepository {
    return new ObjectStorageDatasetChunkRepository(input.objectStorage);
  }

  private constructor(private readonly objects: ObjectStorage) {}

  async writeChunks(params: {
    projectId: string;
    datasetId: string;
    records: unknown[];
    fromIndex?: number;
    maxBytes?: number;
  }): Promise<DatasetChunk[]> {
    const { projectId, datasetId, records, fromIndex = 0, maxBytes } = params;
    assertNoTraversal(projectId, datasetId);
    const chunks = toJsonlChunks(records, maxBytes ? { maxBytes } : {}).map((chunk) => ({
      ...chunk,
      index: chunk.index + fromIndex,
    }));
    for (const chunk of chunks) {
      await this.put(chunkAddress(projectId, datasetId, chunk.index), chunk.jsonl);
    }
    return chunks;
  }

  async readChunks(params: {
    projectId: string;
    datasetId: string;
    chunkCount: number;
  }): Promise<unknown[]> {
    const rows: unknown[] = [];
    for (let index = 0; index < params.chunkCount; index++) {
      rows.push(...(await this.readChunk({ ...params, index })));
    }
    return rows;
  }

  async readChunk(params: {
    projectId: string;
    datasetId: string;
    index: number;
  }): Promise<unknown[]> {
    assertNoTraversal(params.projectId, params.datasetId);
    const at = chunkAddress(params.projectId, params.datasetId, params.index);
    let body: AsyncIterable<Uint8Array>;
    try {
      body = await this.objects.read(at);
    } catch (error) {
      if (isAbsent(error)) throw new MissingChunkError(at.key);
      throw error;
    }
    return parseJsonl(await textOf(body));
  }

  async rewriteChunk(params: {
    projectId: string;
    datasetId: string;
    index: number;
    records: unknown[];
  }): Promise<ChunkOffset> {
    const { projectId, datasetId, index, records } = params;
    assertNoTraversal(projectId, datasetId);
    const { jsonl, byteSize } = toSingleJsonl(records);
    if (byteSize > CHUNK_MAX_BYTES) {
      throw new ChunkTooLargeError({ byteSize, maxBytes: CHUNK_MAX_BYTES });
    }
    await this.put(chunkAddress(projectId, datasetId, index), jsonl);
    return { index, startRow: 0, endRow: records.length, byteSize };
  }

  async deleteChunksFrom(params: {
    projectId: string;
    datasetId: string;
    fromIndex: number;
  }): Promise<void> {
    assertNoTraversal(params.projectId, params.datasetId);
    for (let index = params.fromIndex; index < Number.MAX_SAFE_INTEGER; index++) {
      const at = chunkAddress(params.projectId, params.datasetId, index);
      if (!(await this.exists(at))) return;
      await this.objects.remove(at);
    }
  }

  readStagedUpload(params: {
    projectId: string;
    stagingKey: string;
  }): Promise<AsyncIterable<Uint8Array>> {
    return this.objects.read(stagedAddress(params.projectId, params.stagingKey));
  }

  removeStagedUpload(params: { projectId: string; stagingKey: string }): Promise<void> {
    return this.objects.remove(stagedAddress(params.projectId, params.stagingKey));
  }

  private async put(at: StoredObjectAddress, text: string): Promise<void> {
    const bytes = new TextEncoder().encode(text);
    await this.objects.write(at, once(bytes), {
      byteLength: bytes.byteLength,
      contentType: JSONL_MEDIA_TYPE,
    });
  }

  private async exists(at: StoredObjectAddress): Promise<boolean> {
    try {
      const body = await this.objects.read(at);
      await body[Symbol.asyncIterator]().return?.();
      return true;
    } catch (error) {
      if (isAbsent(error)) return false;
      throw error;
    }
  }
}

function chunkAddress(projectId: string, datasetId: string, index: number): StoredObjectAddress {
  return { projectId, key: chunkKey(projectId, datasetId, index) };
}

function stagedAddress(projectId: string, stagingKey: string): StoredObjectAddress {
  assertKeyWithinProject(projectId, stagingKey);
  return { projectId, key: stagingKey };
}

function isAbsent(error: unknown): boolean {
  return error instanceof Error && error.name === "StoredObjectNotFoundError";
}

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

async function textOf(body: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const part of body) text += decoder.decode(part, { stream: true });
  return text + decoder.decode();
}
