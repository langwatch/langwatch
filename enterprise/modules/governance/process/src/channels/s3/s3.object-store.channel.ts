// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { AwsClientConfiguration } from "@langwatch/aws-client";
import { createSsrfUrlValidator } from "@langwatch/egress";

import type {
  GovernanceObjectStorageCredentials,
  GovernanceObjectStore,
} from "../../app/governance.members.ts";

const MAX_S3_FILES = 100;
const MAX_S3_PAGES = 50;

type ObjectStoreTarget = {
  region: string;
  endpoint?: string;
  credentials: GovernanceObjectStorageCredentials;
};

function defaultS3Host(region: string): string {
  const suffix = region.startsWith("cn-") ? ".amazonaws.com.cn" : ".amazonaws.com";
  return `s3.${region}${suffix}`;
}

function appendListedKeys(
  keys: string[],
  contents: readonly { Key?: string }[],
  limit: number,
): boolean {
  for (const object of contents) {
    if (object.Key) keys.push(object.Key);
    if (keys.length >= Math.min(limit, MAX_S3_FILES)) return true;
  }
  return false;
}

/**
 * A source's own bucket, read with the source's own credentials: a fresh client per call so a
 * rotated credential is honoured on the next tick, its host judged by the egress fence first.
 */
export class S3ObjectStoreChannel implements GovernanceObjectStore {
  // Main's pullers reached S3 directly, never through the platform's outbound proxy.
  readonly #aws = AwsClientConfiguration.create({
    outboundProxy: { tryResolveForHost: () => undefined },
  });
  readonly #validate = createSsrfUrlValidator({ blockLocal: true, allowedHosts: [] });

  private constructor() {}

  static create(): S3ObjectStoreChannel {
    return new S3ObjectStoreChannel();
  }

  async list(
    input: Parameters<GovernanceObjectStore["list"]>[0],
  ): Promise<{ keys: string[]; isTruncated: boolean }> {
    return this.#withClient(input, async (client) => {
      const keys: string[] = [];
      let continuationToken: string | undefined;
      let pages = 0;
      do {
        pages += 1;
        const response = await client.send(
          new ListObjectsV2Command({
            Bucket: input.bucket,
            Prefix: input.prefix,
            StartAfter: continuationToken ? undefined : input.startAfter,
            ContinuationToken: continuationToken,
            MaxKeys: 1_000,
          }),
          { abortSignal: input.signal },
        );
        if (appendListedKeys(keys, response.Contents ?? [], input.limit)) {
          return { keys, isTruncated: true };
        }
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (continuationToken && pages < MAX_S3_PAGES);
      return { keys, isTruncated: continuationToken !== undefined };
    });
  }

  async readText(input: Parameters<GovernanceObjectStore["readText"]>[0]): Promise<string> {
    return this.#withClient(input, async (client) => {
      const where = `s3://${input.bucket}/${input.key}`;
      const response = await client.send(
        new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
        { abortSignal: input.signal },
      );
      if (!response.Body) throw new Error(`empty body for ${where}`);
      if (!(Symbol.asyncIterator in response.Body)) {
        throw new Error(`streaming body unavailable for ${where}`);
      }
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      for await (const chunk of response.Body) {
        if (input.signal?.aborted) throw new Error(`aborted while reading ${where}`);
        totalBytes += chunk.byteLength;
        if (totalBytes > input.maxBytes) {
          throw new Error(`file exceeds ${input.maxBytes} bytes: ${where}`);
        }
        chunks.push(chunk);
      }
      return new TextDecoder().decode(Buffer.concat(chunks));
    });
  }

  async #withClient<T>(
    input: ObjectStoreTarget,
    operation: (client: S3Client) => Promise<T>,
  ): Promise<T> {
    const targetHost = input.endpoint ? new URL(input.endpoint).host : defaultS3Host(input.region);
    await this.#validate(input.endpoint ?? `https://${targetHost}/`);
    const { accessKeyId, secretAccessKey, sessionToken } = input.credentials;
    const client = new S3Client({
      ...this.#aws.build({
        region: input.region,
        endpoint: input.endpoint,
        targetHost,
        staticCredentials: { accessKeyId, secretAccessKey, sessionToken },
      }),
      forcePathStyle: input.endpoint !== undefined,
    });
    try {
      return await operation(client);
    } finally {
      client.destroy();
    }
  }
}
