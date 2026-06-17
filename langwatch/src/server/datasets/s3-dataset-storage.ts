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
 * The S3 client is memoized per `projectId` (the "singleton client" goal)
 * without leaking across projects — each project resolves its own BYOC /
 * global bucket + credentials through `createS3Client`.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";
import { createS3Client } from "../storage";
import {
  assertKeyWithinProject,
  assertNoTraversal,
  chunkKey,
  type DatasetChunk,
  errorHasProp,
  parseJsonl,
  toJsonlChunks,
} from "./dataset-chunking";
import type { DatasetStorage, PresignedUpload } from "./dataset-storage";
import { StagedUploadNotFoundError } from "./errors";
import { stagingUploadKey, UPLOAD_TTL_SECONDS } from "./presigned-upload";

type ResolvedS3Client = { s3Client: S3Client; s3Bucket: string };

export class S3DatasetStorage implements DatasetStorage {
  /**
   * Per-project memo of the resolved S3 client. Keyed by `projectId` so two
   * projects never share a client (and thus never cross BYOC buckets or
   * credentials). A single instance serving one request resolves each
   * project's client once.
   */
  private readonly clients = new Map<string, Promise<ResolvedS3Client>>();

  private client(projectId: string): Promise<ResolvedS3Client> {
    const cached = this.clients.get(projectId);
    if (cached) return cached;
    const created = createS3Client(projectId);
    this.clients.set(projectId, created);
    // Evict a transient resolution failure so the next call retries instead of
    // caching a rejected promise forever (M4).
    created.catch(() => this.clients.delete(projectId));
    return created;
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
    const { s3Client, s3Bucket } = await this.client(projectId);
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
    const { s3Client, s3Bucket } = await this.client(projectId);
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
        if (errorHasProp(error, "name", "NoSuchKey")) {
          throw new Error(`Missing dataset chunk: ${key}`);
        }
        throw error;
      }
      // An empty chunk parses to []; never silently skip (m2). The
      // missing-chunk invariant is already enforced by the throw above.
      rows.push(...parseJsonl(jsonl));
    }
    return rows;
  }

  async createPresignedUpload({
    projectId,
  }: {
    projectId: string;
  }): Promise<PresignedUpload> {
    const uploadId = nanoid();
    const key = stagingUploadKey(projectId, uploadId);
    const { s3Client, s3Bucket } = await this.client(projectId);
    const url = await getSignedUrl(
      s3Client,
      new PutObjectCommand({ Bucket: s3Bucket, Key: key }),
      { expiresIn: UPLOAD_TTL_SECONDS },
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
    const { s3Client, s3Bucket } = await this.client(projectId);
    let head: HeadObjectCommandOutput;
    try {
      head = await s3Client.send(
        new HeadObjectCommand({ Bucket: s3Bucket, Key: key }),
      );
    } catch (error: unknown) {
      // A never-completed (or already-reaped) upload — distinct from a too-large
      // one (M5). NoSuchKey / NotFound both surface here depending on the SDK.
      if (
        errorHasProp(error, "name", "NoSuchKey") ||
        errorHasProp(error, "name", "NotFound") ||
        errorHasProp(error, "code", "NoSuchKey") ||
        errorHasProp(error, "code", "NotFound")
      ) {
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
  }

  async deleteStaged({
    projectId,
    key,
  }: {
    projectId: string;
    key: string;
  }): Promise<void> {
    assertKeyWithinProject(projectId, key);
    const { s3Client, s3Bucket } = await this.client(projectId);
    await s3Client.send(
      new DeleteObjectCommand({ Bucket: s3Bucket, Key: key }),
    );
  }
}
