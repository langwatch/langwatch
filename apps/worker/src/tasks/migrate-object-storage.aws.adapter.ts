import type { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { AwsClientProcessRuntime } from "@langwatch/aws-client";
import {
  ObjectNotFoundError,
  type StoredObjectStorageDriver,
} from "@langwatch/stored-object-server";

export type MigrationS3Configuration = {
  bucket: string;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
};

export type MigrationS3RegionConfiguration = {
  endpoint?: string;
  region?: string;
};

/** Task-owned S3 driver backed by the executable's process-owned AWS transport. */
export class MigrationS3StorageDriver implements StoredObjectStorageDriver {
  static create(input: {
    aws: AwsClientProcessRuntime;
    config: MigrationS3Configuration;
  }): MigrationS3StorageDriver {
    return new MigrationS3StorageDriver(input.aws, input.config);
  }

  private readonly client: S3Client;

  private constructor(aws: AwsClientProcessRuntime, config: MigrationS3Configuration) {
    const region = resolveMigrationS3Region(config);
    this.client = new S3Client({
      ...aws.build({
        region,
        endpoint: config.endpoint,
        targetHost: config.endpoint ?? defaultS3Host(region),
        staticCredentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
          sessionToken: config.sessionToken,
        },
      }),
      forcePathStyle: !!config.endpoint,
    });
  }

  async get(uri: string): Promise<Readable> {
    const { bucket, key } = parseS3Uri(uri);
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return response.Body as Readable;
    } catch (error) {
      if (isS3Missing(error)) throw new ObjectNotFoundError(uri);
      throw error;
    }
  }

  async put(uri: string, bytes: Buffer, mediaType: string): Promise<void> {
    const { bucket, key } = parseS3Uri(uri);
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: mediaType,
      }),
    );
  }

  async delete(uri: string): Promise<void> {
    const { bucket, key } = parseS3Uri(uri);
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async exists(uri: string): Promise<boolean> {
    const { bucket, key } = parseS3Uri(uri);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch (error) {
      if (isS3Missing(error)) return false;
      throw error;
    }
  }

  close(): void {
    this.client.destroy();
  }
}

export function resolveMigrationS3Region(
  config: MigrationS3RegionConfiguration,
): string | undefined {
  return (
    config.region ?? (config.endpoint && !isAwsS3Endpoint(config.endpoint) ? "auto" : undefined)
  );
}

function defaultS3Host(region: string | undefined): string {
  if (!region || region === "auto") return "s3.amazonaws.com";

  const suffix = region.startsWith("cn-") ? ".amazonaws.com.cn" : ".amazonaws.com";
  return `s3.${region}${suffix}`;
}

function isAwsS3Endpoint(endpoint: string): boolean {
  try {
    const hostname = new URL(endpoint).hostname.toLowerCase();
    return (
      hostname === "s3.amazonaws.com" ||
      hostname.endsWith(".amazonaws.com") ||
      hostname.endsWith(".amazonaws.com.cn")
    );
  } catch {
    return false;
  }
}

function parseS3Uri(uri: string): { bucket: string; key: string } {
  const parsed = new URL(uri);
  if (parsed.protocol !== "s3:" || !parsed.hostname || parsed.pathname === "/") {
    throw new Error(`Invalid S3 migration URI: ${uri}`);
  }
  return { bucket: parsed.hostname, key: parsed.pathname.slice(1) };
}

function isS3Missing(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    value.name === "NoSuchKey" ||
    value.name === "NotFound" ||
    value.$metadata?.httpStatusCode === 404
  );
}
