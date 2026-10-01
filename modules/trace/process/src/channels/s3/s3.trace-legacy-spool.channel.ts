import { Readable } from "node:stream";

import { DeleteObjectCommand, GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";

import type { TraceLegacySpool } from "../trace-legacy-spool.channel.ts";

export interface S3ClientResolution {
  s3Client: S3Client;
  s3Bucket: string;
}

/** Resolves the per-organization S3 client + bucket for a project. */
export type S3ClientResolver = (projectId: string) => Promise<S3ClientResolution>;

export class S3TraceLegacySpoolChannel implements TraceLegacySpool {
  readonly #resolveS3Client: S3ClientResolver;

  static create({
    resolveS3Client,
  }: {
    resolveS3Client: S3ClientResolver;
  }): S3TraceLegacySpoolChannel {
    return new S3TraceLegacySpoolChannel(resolveS3Client);
  }

  private constructor(resolveS3Client: S3ClientResolver) {
    this.#resolveS3Client = resolveS3Client;
  }

  async openRead({ projectId, key }: { projectId: string; key: string }): Promise<Readable> {
    const { s3Client, s3Bucket } = await this.#resolveS3Client(projectId);
    const { Body } = await s3Client.send(new GetObjectCommand({ Bucket: s3Bucket, Key: key }));
    if (!Body) {
      throw new Error(
        `Spool object returned no body from S3 (key=${key}) — cannot reconstitute command`,
      );
    }
    if (!(Body instanceof Readable)) {
      throw new Error(`Spool object returned a non-streaming body from S3 (key=${key})`);
    }

    return Body;
  }

  async delete({ projectId, key }: { projectId: string; key: string }): Promise<void> {
    const { s3Client, s3Bucket } = await this.#resolveS3Client(projectId);
    await s3Client.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: key }));
  }
}
