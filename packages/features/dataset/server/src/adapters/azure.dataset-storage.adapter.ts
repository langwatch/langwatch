/**
 * ADR-032 / AC37 (issue #4133): Azure Blob implementation of `DatasetStorage`.
 *
 * Mirrors `S3DatasetStorage`'s shape (chunked-JSONL I/O + a staged-upload
 * flow for the finalize/normalize pipeline) but reuses the existing
 * `AzureBlobDriver` (get/put/delete/exists) as the byte-level transport
 * instead of the AWS SDK — the driver already speaks the Azure Blob REST API
 * and handles SharedKey signing, including Azurite's path-style addressing.
 *
 * Azure Blob has no cross-origin presigned-PUT primitive wired up here (a SAS
 * URL needs signing surface this driver doesn't implement — out of scope for
 * this rung). Like `LocalDatasetStorage`, this backend mints a SAME-ORIGIN
 * staging URL: the browser PUTs through the app, which streams the bytes to
 * Azure via `putStaged`.
 *
 * The pure chunk math lives in `dataset-chunking.ts`; this class composes it,
 * it never reimplements it (same discipline as the S3 / local impls).
 */
import type { Readable } from "node:stream";
import { nanoid } from "nanoid";
import {
  assertKeyWithinProject,
  assertNoTraversal,
  CHUNK_MAX_BYTES,
  type ChunkOffset,
  chunkKey,
  type DatasetChunk,
  parseJsonl,
  toJsonlChunks,
  toSingleJsonl,
} from "../services/dataset-chunking";
import type {
  DatasetStorage,
  PresignedUpload,
  DatasetAzureConfigResolver,
} from "../ports/dataset-storage.port";
import {
  ChunkTooLargeError,
  MissingChunkError,
  StagedUploadNotFoundError,
  UploadTooLargeError,
} from "../services/errors";
import { localStagingUploadPath, stagingUploadKey } from "../services/presigned-upload";

/**
 * Reads a Readable fully as a utf-8 string (chunk objects are JSONL text).
 * Capped at CHUNK_MAX_BYTES — chunks are written under that bound by
 * `toJsonlChunks`, so anything larger is a tampered or corrupted object and
 * must not be allowed to exhaust the heap.
 */
async function streamToString(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.byteLength;
    if (size > CHUNK_MAX_BYTES) {
      throw new UploadTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export class AzureDatasetStorageAdapter implements DatasetStorage {
  static create(resolver: DatasetAzureConfigResolver): AzureDatasetStorageAdapter {
    return new AzureDatasetStorageAdapter(resolver);
  }
  constructor(private readonly resolver: DatasetAzureConfigResolver) {}

  private uriFor({
    accountName,
    container,
    key,
  }: {
    accountName: string;
    container: string;
    key: string;
  }): string {
    return `azure-blob://${accountName}/${container}/${key}`;
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
    const { driver, accountName, container } = await this.resolver.resolve(projectId);
    for (const chunk of chunks) {
      const uri = this.uriFor({
        accountName,
        container,
        key: chunkKey(projectId, datasetId, chunk.index),
      });
      await driver.put(uri, Buffer.from(chunk.jsonl, "utf-8"), "application/x-ndjson");
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
    const { driver, accountName, container } = await this.resolver.resolve(projectId);
    // Chunks are contiguous from 0, so walk upward and stop at the first miss
    // (the first gap) — no fixed cap needed.
    for (let i = fromIndex; ; i++) {
      const uri = this.uriFor({
        accountName,
        container,
        key: chunkKey(projectId, datasetId, i),
      });
      const exists = await driver.exists(uri);
      if (!exists) return;
      await driver.delete(uri);
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
    const { driver, accountName, container } = await this.resolver.resolve(projectId);
    const rows: unknown[] = [];
    for (let i = 0; i < chunkCount; i++) {
      const key = chunkKey(projectId, datasetId, i);
      const uri = this.uriFor({ accountName, container, key });
      let jsonl: string;
      try {
        jsonl = await streamToString(await driver.get(uri));
      } catch (error: unknown) {
        if (isObjectNotFound(error)) {
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
    const { driver, accountName, container } = await this.resolver.resolve(projectId);
    const key = chunkKey(projectId, datasetId, index);
    const uri = this.uriFor({ accountName, container, key });
    let jsonl: string;
    try {
      jsonl = await streamToString(await driver.get(uri));
    } catch (error: unknown) {
      if (isObjectNotFound(error)) {
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
    // Decision 2: an edit can replace a small row with a large value, so a
    // rewrite CAN grow a chunk past the cap. Reject rather than write an
    // oversized object (parity with the S3 / local impls).
    if (byteSize > CHUNK_MAX_BYTES) {
      throw new ChunkTooLargeError({ byteSize, maxBytes: CHUNK_MAX_BYTES });
    }
    const { driver, accountName, container } = await this.resolver.resolve(projectId);
    const uri = this.uriFor({
      accountName,
      container,
      key: chunkKey(projectId, datasetId, index),
    });
    await driver.put(uri, Buffer.from(jsonl, "utf-8"), "application/x-ndjson");
    // startRow/endRow are chunk-LOCAL here; the caller recomputes global offsets.
    return { index, startRow: 0, endRow: records.length, byteSize };
  }

  /**
   * No cross-origin presign wired up for Azure yet (a SAS URL needs signing
   * surface this driver doesn't implement — out of scope here). Like
   * `LocalDatasetStorage`, mint a SAME-ORIGIN staging URL: the browser PUTs
   * through the app, which streams the bytes to Azure via `putStaged`.
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
   * Deposits a staged upload from a byte stream, server-side — the same-origin
   * `/direct-upload/staging/:uploadId` route calls this (parity with
   * `LocalDatasetStorage.putStaged`). `maxBytes` is enforced mid-stream: the
   * shared `streamToBuffer` destroys the stream the moment the cap is
   * exceeded, so an authed client can't fill the heap before the check runs.
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
    const { driver, accountName, container } = await this.resolver.resolve(projectId);
    let buffer: Buffer;
    try {
      buffer = await readStream(body, maxBytes);
    } catch (error: unknown) {
      if (error instanceof UploadTooLargeError) {
        throw new UploadTooLargeError();
      }
      throw error;
    }
    const uri = this.uriFor({ accountName, container, key });
    await driver.put(uri, buffer, "application/octet-stream");
  }

  /** HEAD-equivalent for a staged upload's size — finalize size-cap enforcement. */
  async headStagedObjectSize({
    projectId,
    key,
  }: {
    projectId: string;
    key: string;
  }): Promise<number> {
    assertKeyWithinProject(projectId, key);
    const { driver, accountName, container } = await this.resolver.resolve(projectId);
    const uri = this.uriFor({ accountName, container, key });
    try {
      // Signed HEAD — Content-Length only, never the body. Downloading the
      // staged upload to measure it would defeat the size cap this method
      // exists to enforce (review finding on PR #6092).
      return await driver.head(uri);
    } catch (error: unknown) {
      if (isObjectNotFound(error)) {
        throw new StagedUploadNotFoundError();
      }
      throw error;
    }
  }

  async deleteStaged({ projectId, key }: { projectId: string; key: string }): Promise<void> {
    assertKeyWithinProject(projectId, key);
    const { driver, accountName, container } = await this.resolver.resolve(projectId);
    const uri = this.uriFor({ accountName, container, key });
    await driver.delete(uri);
  }

  async streamStaged({ projectId, key }: { projectId: string; key: string }): Promise<Readable> {
    assertKeyWithinProject(projectId, key);
    const { driver, accountName, container } = await this.resolver.resolve(projectId);
    const uri = this.uriFor({ accountName, container, key });
    try {
      return await driver.get(uri);
    } catch (error: unknown) {
      if (isObjectNotFound(error)) {
        throw new StagedUploadNotFoundError();
      }
      throw error;
    }
  }
}

export const AzureDatasetStorage = AzureDatasetStorageAdapter;

const isObjectNotFound = (error: unknown): boolean =>
  error instanceof Error && error.name === "ObjectNotFoundError";

const readStream = async (
  stream: Readable,
  maxBytes = Number.MAX_SAFE_INTEGER,
): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.byteLength;
    if (size > maxBytes) throw new UploadTooLargeError();
    chunks.push(value);
  }
  return Buffer.concat(chunks);
};
