import type { Readable } from "node:stream";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { defaultS3Host, s3RegionOf, type AwsClientProcessRuntime } from "@langwatch/aws-client";
import { ObjectNotFoundError } from "@langwatch/stored-object-contract";

import type { StoredObjectBlobRepository } from "#repositories/stored-object-blob.repository";
import { parseS3Uri } from "#rules/s3-uri.rules";

type MigrationS3Configuration = {
  bucket: string;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
};

/** Task-owned S3 driver backed by the executable's process-owned AWS transport. */
export class MigrationBlobS3Repository implements StoredObjectBlobRepository {
  static create(input: {
    aws: AwsClientProcessRuntime;
    config: MigrationS3Configuration;
  }): MigrationBlobS3Repository {
    return new MigrationBlobS3Repository(input.aws, input.config);
  }

  private readonly client: S3Client;

  private constructor(aws: AwsClientProcessRuntime, config: MigrationS3Configuration) {
    const region = s3RegionOf({ region: config.region, endpoint: config.endpoint });
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

function isS3Missing(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    value.name === "NoSuchKey" ||
    value.name === "NotFound" ||
    value.$metadata?.httpStatusCode === 404
  );
}
