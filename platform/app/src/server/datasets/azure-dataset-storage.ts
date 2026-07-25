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
import { streamToBuffer, StreamTooLargeError } from "~/utils/streamToBuffer";
import { AzureBlobDriver } from "~/server/stored-objects/azure-blob-driver";
import { resolveAzureCredentials } from "~/server/stored-objects/azure-credentials";
import { ObjectNotFoundError } from "~/server/stored-objects/errors";
import { resolveProjectStorageDestination } from "~/server/stored-objects/project-storage-destination";
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
} from "./dataset-chunking";
import type { DatasetStorage, PresignedUpload } from "./dataset-storage";
import {
  ChunkTooLargeError,
  MissingChunkError,
  StagedUploadNotFoundError,
  UploadTooLargeError,
} from "./errors";
import { localStagingUploadPath, stagingUploadKey } from "./presigned-upload";

/** Resolved per-project Azure wiring: the driver plus the account/container it addresses. */
type ResolvedAzureConfig = {
  driver: AzureBlobDriver;
  accountName: string;
  container: string;
};

/**
 * Reads a Readable fully as a utf-8 string (chunk objects are JSONL text).
 * Capped at CHUNK_MAX_BYTES — chunks are written under that bound by
 * `toJsonlChunks`, so anything larger is a tampered or corrupted object and
 * must not be allowed to exhaust the heap.
 */
async function streamToString(stream: Readable): Promise<string> {
  return (await streamToBuffer(stream, CHUNK_MAX_BYTES)).toString("utf-8");
}

export class AzureDatasetStorage implements DatasetStorage {
  /**
   * Per-project memo of the resolved driver + account/container, keyed by
   * `projectId` so two projects never share a client (parity with
   * `S3DatasetStorage`'s per-project client memo).
   */
  private readonly configs = new Map<string, Promise<ResolvedAzureConfig>>();

  private config(projectId: string): Promise<ResolvedAzureConfig> {
    const cached = this.configs.get(projectId);
    if (cached) return cached;
    const created = this.resolveConfig(projectId);
    this.configs.set(projectId, created);
    // Evict a transient resolution failure so the next call retries instead of
    // caching a rejected promise forever (parity with S3DatasetStorage M4).
    created.catch(() => this.configs.delete(projectId));
    return created;
  }

  private async resolveConfig(projectId: string): Promise<ResolvedAzureConfig> {
    const destination = await resolveProjectStorageDestination(projectId);
    if (destination.kind !== "azure") {
      throw new Error(
        `AzureDatasetStorage invoked for project ${projectId} whose resolved storage destination is "${destination.kind}", not azure.`,
      );
    }
    // Invariant: a kind === "azure" destination is only ever returned after
    // resolveProjectStorageDestination (via resolveAzureCredentials, the
    // single source of truth for every auth mode) validated the required
    // vars for whichever mode is active — AzureBackendMisconfiguredError
    // names any missing/contradictory one. Re-resolving here rather than
    // reading AZURE_BLOB_ACCOUNT_KEY directly is what keeps this working in
    // a token-based mode, where there is no account key to read.
    const driver = new AzureBlobDriver(resolveAzureCredentials());
    return {
      driver,
      accountName: destination.accountName,
      container: destination.container,
    };
  }

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
    const chunks = toJsonlChunks(records, maxBytes ? { maxBytes } : {}).map(
      (c) => ({ ...c, index: c.index + fromIndex }),
    );
    const { driver, accountName, container } = await this.config(projectId);
    for (const chunk of chunks) {
      const uri = this.uriFor({
        accountName,
        container,
        key: chunkKey(projectId, datasetId, chunk.index),
      });
      await driver.put(
        uri,
        Buffer.from(chunk.jsonl, "utf-8"),
        "application/x-ndjson",
      );
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
    const { driver, accountName, container } = await this.config(projectId);
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
    const { driver, accountName, container } = await this.config(projectId);
    const rows: unknown[] = [];
    for (let i = 0; i < chunkCount; i++) {
      const key = chunkKey(projectId, datasetId, i);
      const uri = this.uriFor({ accountName, container, key });
      let jsonl: string;
      try {
        jsonl = await streamToString(await driver.get(uri));
      } catch (error: unknown) {
        if (error instanceof ObjectNotFoundError) {
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
    const { driver, accountName, container } = await this.config(projectId);
    const key = chunkKey(projectId, datasetId, index);
    const uri = this.uriFor({ accountName, container, key });
    let jsonl: string;
    try {
      jsonl = await streamToString(await driver.get(uri));
    } catch (error: unknown) {
      if (error instanceof ObjectNotFoundError) {
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
    const { driver, accountName, container } = await this.config(projectId);
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
  createPresignedUpload({
    projectId,
  }: {
    projectId: string;
  }): Promise<PresignedUpload> {
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
    const { driver, accountName, container } = await this.config(projectId);
    let buffer: Buffer;
    try {
      buffer = await streamToBuffer(body, maxBytes);
    } catch (error: unknown) {
      if (error instanceof StreamTooLargeError) {
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
    const { driver, accountName, container } = await this.config(projectId);
    const uri = this.uriFor({ accountName, container, key });
    try {
      // Signed HEAD — Content-Length only, never the body. Downloading the
      // staged upload to measure it would defeat the size cap this method
      // exists to enforce (review finding on PR #6092).
      return await driver.head(uri);
    } catch (error: unknown) {
      if (error instanceof ObjectNotFoundError) {
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
    const { driver, accountName, container } = await this.config(projectId);
    const uri = this.uriFor({ accountName, container, key });
    await driver.delete(uri);
  }

  async streamStaged({
    projectId,
    key,
  }: {
    projectId: string;
    key: string;
  }): Promise<Readable> {
    assertKeyWithinProject(projectId, key);
    const { driver, accountName, container } = await this.config(projectId);
    const uri = this.uriFor({ accountName, container, key });
    try {
      return await driver.get(uri);
    } catch (error: unknown) {
      if (error instanceof ObjectNotFoundError) {
        throw new StagedUploadNotFoundError();
      }
      throw error;
    }
  }
}
