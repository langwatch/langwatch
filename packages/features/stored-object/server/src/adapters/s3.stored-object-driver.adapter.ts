/**
 * S3StoredObjectDriver — byte operations over S3-compatible object storage.
 *
 * Constructed per project so the correct BYOC endpoint, region and credentials
 * are resolved for every operation: a URI minted against a tenant's own bucket
 * is unreadable through the deployment's shared client, so which connection
 * answers is a function of the project rather than of the process.
 *
 * The bucket and key are taken from the URI itself and never from
 * configuration — a persisted `s3://` URI is the address, and reading it
 * through a differently-configured bucket would answer for the wrong object.
 */
import type { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getStoredObjectStorageScheme } from "@langwatch/stored-object-contract";
import { ObjectNotFoundError } from "../errors";
import type {
  StoredObjectS3Target,
  StoredObjectS3TargetPort,
} from "../ports/stored-object-s3-target.port";
import type { StoredObjectStorageDriver } from "./stored-object-storage.registry";

/**
 * The process's shared AWS transport policy, as this driver asks for it.
 *
 * Structural rather than an `AwsClientProcessRuntime` import: what the driver
 * needs is one call that turns a target into client configuration, and the
 * pooling, proxying and retry policy behind it are the process's.
 */
export type StoredObjectS3ClientPolicy = Readonly<{
  build(input: {
    region?: string | undefined;
    targetHost: string;
    endpoint?: string | undefined;
    staticCredentials?: StoredObjectS3Target["credentials"];
  }): S3ClientConfig;
}>;

/**
 * Decomposes an `s3://<bucket>/<key>` URI into its bucket and key parts.
 *
 * @throws if the URI scheme is not "s3".
 */
function parseS3Uri(uri: string): { bucket: string; key: string } {
  // Throws if not "s3"
  getStoredObjectStorageScheme(uri);

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

/** Storage driver for S3-compatible object storage, scoped to one project. */
export class S3StoredObjectDriver implements StoredObjectStorageDriver {
  static create(options: {
    projectId: string;
    targets: StoredObjectS3TargetPort;
    policy: StoredObjectS3ClientPolicy;
  }): S3StoredObjectDriver {
    return new S3StoredObjectDriver(options.projectId, options.targets, options.policy);
  }

  private constructor(
    private readonly projectId: string,
    private readonly targets: StoredObjectS3TargetPort,
    private readonly policy: StoredObjectS3ClientPolicy,
  ) {}

  /**
   * Returns a readable stream for the object at the given S3 URI.
   *
   * @throws {ObjectNotFoundError} when the object does not exist (NoSuchKey / 404).
   */
  async get(uri: string): Promise<Readable> {
    const { bucket, key } = parseS3Uri(uri);
    const client = await this.client();

    try {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
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
    const client = await this.client();

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: mediaType,
      }),
    );
  }

  /** Deletes the object at the given S3 URI. */
  async delete(uri: string): Promise<void> {
    const { bucket, key } = parseS3Uri(uri);
    const client = await this.client();

    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  /**
   * Returns true if an object exists at the given S3 URI, false if it does not.
   *
   * @throws on any S3 error other than 404.
   */
  async exists(uri: string): Promise<boolean> {
    const { bucket, key } = parseS3Uri(uri);
    const client = await this.client();

    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch (error: unknown) {
      if (isNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }

  private async client(): Promise<S3Client> {
    const target = await this.targets.resolve(this.projectId);
    return new S3Client({
      ...this.policy.build({
        region: target.region,
        // The project endpoint is the actual network destination for BYOC S3
        // providers. AWS' default endpoint needs a stable public host so the
        // process-owned proxy policy can make the same decision as SES/SQS.
        targetHost: target.endpoint ?? defaultS3Host(target.region),
        endpoint: target.endpoint,
        staticCredentials: target.credentials,
      }),
      forcePathStyle: true,
    });
  }
}

/** Returns true for S3 "object not found" errors (NoSuchKey or NotFound). */
function isNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const name = (error as { name?: string }).name;
  const statusCode = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
    ?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || statusCode === 404;
}

function defaultS3Host(region: string | undefined): string {
  if (!region || region === "auto") return "s3.amazonaws.com";

  const suffix = region.startsWith("cn-") ? ".amazonaws.com.cn" : ".amazonaws.com";
  return `s3.${region}${suffix}`;
}
