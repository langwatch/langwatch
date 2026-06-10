/**
 * S3Driver — StorageDriver implementation backed by AWS S3-compatible storage.
 *
 * Constructed per-project so it can resolve the correct BYOC config via
 * `createS3Client`. URI scheme must be "s3"; the bucket and key are extracted
 * directly from the URI and passed through to S3 commands.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import { createS3Client } from "~/server/storage";
import { ObjectNotFoundError } from "./errors";
import type { StorageDriver } from "./storage-driver";
import { getUriScheme } from "./uri";

/**
 * Decomposes an `s3://<bucket>/<key>` URI into its bucket and key parts.
 *
 * @throws if the URI scheme is not "s3".
 */
function parseS3Uri(uri: string): { bucket: string; key: string } {
  // Throws if not "s3"
  getUriScheme(uri);

  // s3://bucket/key  → strip "s3://"
  const withoutScheme = uri.slice("s3://".length);
  const slashIndex = withoutScheme.indexOf("/");

  if (slashIndex === -1) {
    throw new Error(`Invalid S3 URI (no key): "${uri}"`);
  }

  const bucket = withoutScheme.slice(0, slashIndex);
  const key = withoutScheme.slice(slashIndex + 1);

  if (!bucket) {
    throw new Error(`Invalid S3 URI (empty bucket): "${uri}"`);
  }
  if (!key) {
    throw new Error(`Invalid S3 URI (empty key): "${uri}"`);
  }

  return { bucket, key };
}

/**
 * StorageDriver implementation for S3-compatible object storage.
 *
 * Pass `projectId` at construction time so the correct BYOC S3 credentials
 * are resolved for every operation.
 */
export class S3Driver implements StorageDriver {
  constructor(private readonly projectId: string) {}

  /**
   * Returns a readable stream for the object at the given S3 URI.
   *
   * @throws {ObjectNotFoundError} when the object does not exist (NoSuchKey / 404).
   */
  async get(uri: string): Promise<Readable> {
    const { bucket, key } = parseS3Uri(uri);
    const { s3Client } = await createS3Client(this.projectId);

    try {
      const response = await s3Client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      return response.Body as Readable;
    } catch (error: unknown) {
      if (isNotFoundError(error)) {
        throw new ObjectNotFoundError(uri);
      }
      throw error;
    }
  }

  /**
   * Writes bytes to the given S3 URI with the specified media type.
   * Content-addressed keys make this operation idempotent.
   */
  async put(uri: string, bytes: Buffer, mediaType: string): Promise<void> {
    const { bucket, key } = parseS3Uri(uri);
    const { s3Client } = await createS3Client(this.projectId);

    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: mediaType,
      }),
    );
  }

  /**
   * Deletes the object at the given S3 URI.
   */
  async delete(uri: string): Promise<void> {
    const { bucket, key } = parseS3Uri(uri);
    const { s3Client } = await createS3Client(this.projectId);

    await s3Client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key }),
    );
  }

  /**
   * Returns true if an object exists at the given S3 URI, false if it does not.
   *
   * @throws on any S3 error other than 404.
   */
  async exists(uri: string): Promise<boolean> {
    const { bucket, key } = parseS3Uri(uri);
    const { s3Client } = await createS3Client(this.projectId);

    try {
      await s3Client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      return true;
    } catch (error: unknown) {
      if (isNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }
}

/** Returns true for S3 "object not found" errors (NoSuchKey or NotFound). */
function isNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const name = (error as { name?: string }).name;
  const statusCode = (error as { $metadata?: { httpStatusCode?: number } })
    .$metadata?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || statusCode === 404;
}
