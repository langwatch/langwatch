/**
 * ADR-032: S3 (S3-compatible) implementation of `DatasetStorage`.
 *
 * Folds two previously-separate free-function modules into one provider:
 *   - chunked-JSONL I/O (PutObject per chunk; GetObject + parse), keeping the
 *     throw-on-missing-chunk behavior (a missing chunk that PG's `chunkCount`
 *     claims is corruption, not emptiness — never silently truncate).
 *   - the presigned direct-upload wrappers (presigned PUT via
 *     `s3-request-presigner`, HeadObject for the finalize size check, and a
 *     best-effort DeleteObject for staged objects).
 *
 * Each operation resolves its project's current S3 destination and credentials
 * through the injected resolver. A process may keep one adapter, but it must
 * not pin a tenant's BYOC configuration without an invalidation contract.
 */

import type { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";
import {
  assertKeyWithinProject,
  assertNoTraversal,
  CHUNK_MAX_BYTES,
  type ChunkOffset,
  chunkKey,
  type DatasetChunk,
  isMissingObjectError,
  parseJsonl,
  toJsonlChunks,
  toSingleJsonl,
} from "../services/dataset-chunking";
import type {
  DatasetStorage,
  PresignedUpload,
  DatasetS3ClientResolver,
  DatasetS3Client,
} from "../ports/dataset-storage.port";
import {
  ChunkTooLargeError,
  MissingChunkError,
  StagedUploadNotFoundError,
} from "../services/errors";
import { stagingUploadKey, UPLOAD_TTL_SECONDS } from "../services/presigned-upload";

export class S3DatasetStorageAdapter implements DatasetStorage {
  static create(resolver: DatasetS3ClientResolver): S3DatasetStorageAdapter {
    return new S3DatasetStorageAdapter(resolver);
  }
  constructor(private readonly resolver: DatasetS3ClientResolver) {}

  private async withClient<T>(
    projectId: string,
    operation: (client: DatasetS3Client) => Promise<T>,
  ): Promise<T> {
    const lease = await this.resolver.acquire(projectId);
    try {
      return await operation(lease);
    } finally {
      lease.release();
    }
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
    await this.withClient(projectId, async ({ s3Client, s3Bucket }) => {
      for (const chunk of chunks) {
        await s3Client.send(
          new PutObjectCommand({
            Bucket: s3Bucket,
            Key: chunkKey(projectId, datasetId, chunk.index),
            Body: chunk.jsonl,
            ContentType: "application/x-ndjson",
          }),
        );
      }
    });
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
    await this.withClient(projectId, async ({ s3Client, s3Bucket }) => {
      // Chunks are contiguous from 0, so walk upward and stop at the first miss
      // (the first gap) — no fixed cap needed.
      for (let i = fromIndex; ; i++) {
        const Key = chunkKey(projectId, datasetId, i);
        try {
          await s3Client.send(new HeadObjectCommand({ Bucket: s3Bucket, Key }));
        } catch (error: unknown) {
          if (isMissingObjectError(error)) {
            return;
          }
          throw error;
        }
        await s3Client.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key }));
      }
    });
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
    return this.withClient(projectId, async ({ s3Client, s3Bucket }) => {
      const rows: unknown[] = [];
      for (let i = 0; i < chunkCount; i++) {
        const key = chunkKey(projectId, datasetId, i);
        let jsonl: string;
        try {
          const { Body } = await s3Client.send(
            new GetObjectCommand({ Bucket: s3Bucket, Key: key }),
          );
          jsonl = (await Body?.transformToString()) ?? "";
        } catch (error: unknown) {
          if (isMissingObjectError(error)) {
            throw new MissingChunkError(key);
          }
          throw error;
        }
        // An empty chunk parses to []; never silently skip (m2). The
        // missing-chunk invariant is already enforced by the throw above.
        rows.push(...parseJsonl(jsonl));
      }
      return rows;
    });
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
    return this.withClient(projectId, async ({ s3Client, s3Bucket }) => {
      let jsonl: string;
      try {
        const { Body } = await s3Client.send(new GetObjectCommand({ Bucket: s3Bucket, Key: key }));
        jsonl = (await Body?.transformToString()) ?? "";
      } catch (error: unknown) {
        if (isMissingObjectError(error)) {
          throw new MissingChunkError(key);
        }
        throw error;
      }
      return parseJsonl(jsonl);
    });
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
    // oversized object (splitting on rewrite is out of scope for this rung).
    if (byteSize > CHUNK_MAX_BYTES) {
      throw new ChunkTooLargeError({ byteSize, maxBytes: CHUNK_MAX_BYTES });
    }
    await this.withClient(projectId, ({ s3Client, s3Bucket }) =>
      s3Client.send(
        new PutObjectCommand({
          Bucket: s3Bucket,
          Key: chunkKey(projectId, datasetId, index),
          Body: jsonl,
          ContentType: "application/x-ndjson",
        }),
      ),
    );
    // startRow/endRow are chunk-LOCAL here (0..rowCount); the caller recomputes
    // global offsets from prior chunks under the advisory lock (I-COUNT).
    return { index, startRow: 0, endRow: records.length, byteSize };
  }

  async createPresignedUpload({ projectId }: { projectId: string }): Promise<PresignedUpload> {
    const uploadId = nanoid();
    const key = stagingUploadKey(projectId, uploadId);
    const url = await this.withClient(projectId, ({ s3Client, s3Bucket }) =>
      getSignedUrl(s3Client, new PutObjectCommand({ Bucket: s3Bucket, Key: key }), {
        expiresIn: UPLOAD_TTL_SECONDS,
      }),
    );
    return { uploadId, key, url };
  }

  async headStagedObjectSize({
    projectId,
    key,
  }: {
    projectId: string;
    key: string;
  }): Promise<number> {
    assertKeyWithinProject(projectId, key);
    return this.withClient(projectId, async ({ s3Client, s3Bucket }) => {
      let head: HeadObjectCommandOutput;
      try {
        head = await s3Client.send(new HeadObjectCommand({ Bucket: s3Bucket, Key: key }));
      } catch (error: unknown) {
        // A never-completed (or already-reaped) upload — distinct from a too-large
        // one (M5). NoSuchKey / NotFound both surface here depending on the SDK.
        if (isMissingObjectError(error)) {
          throw new StagedUploadNotFoundError();
        }
        throw error;
      }
      // A HEAD with no ContentLength means the object isn't a complete upload —
      // treat as not-found rather than silently reporting 0 bytes (M5).
      if (head.ContentLength == null) {
        throw new StagedUploadNotFoundError();
      }
      return head.ContentLength;
    });
  }

  async deleteStaged({ projectId, key }: { projectId: string; key: string }): Promise<void> {
    assertKeyWithinProject(projectId, key);
    await this.withClient(projectId, ({ s3Client, s3Bucket }) =>
      s3Client.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: key })),
    );
  }

  async streamStaged({ projectId, key }: { projectId: string; key: string }): Promise<Readable> {
    assertKeyWithinProject(projectId, key);
    const lease = await this.resolver.acquire(projectId);
    try {
      const response = await lease.s3Client.send(
        new GetObjectCommand({ Bucket: lease.s3Bucket, Key: key }),
      );
      // SDK v3 streams the body as a Node Readable in the server runtime
      // (s3-driver relies on the same cast). Backpressure flows through it, so
      // the normalize job never buffers the whole staged file.
      const body = response.Body as Readable;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        lease.release();
      };
      body.once("end", release);
      body.once("error", release);
      body.once("close", release);
      return body;
    } catch (error: unknown) {
      lease.release();
      if (isMissingObjectError(error)) {
        throw new StagedUploadNotFoundError();
      }
      throw error;
    }
  }
}

/** Backwards-compatible feature vocabulary; composition uses the Adapter class. */
export const S3DatasetStorage = S3DatasetStorageAdapter;
