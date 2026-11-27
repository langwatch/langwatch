// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import {
  AwsClientConfiguration,
  defaultS3Host,
  pinnedEndpointConfig,
  s3RegionOf,
} from "@langwatch/aws-client";
import { createSsrfUrlValidator, type SsrfUrlValidator } from "@langwatch/egress";

import type { GovernanceEgressPolicy } from "../http/http.governance-http.channel.ts";
import type {
  GovernanceObjectStorageCredentials,
  GovernanceObjectStore,
} from "../object-store.channel.ts";

const MAX_S3_FILES = 100;
const MAX_S3_PAGES = 50;

type ObjectStoreTarget = {
  region: string;
  endpoint?: string;
  credentials: GovernanceObjectStorageCredentials;
};

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
 * rotated credential is honoured on the next tick. An endpoint override is judged by the egress fence.
 */
export class S3ObjectStoreChannel implements GovernanceObjectStore {
  // Main's pullers reached S3 directly, never through the platform's outbound proxy.
  readonly #aws = AwsClientConfiguration.create({
    outboundProxy: { tryResolveForHost: () => undefined },
  });
  readonly #validate: SsrfUrlValidator;

  private constructor(egress: GovernanceEgressPolicy) {
    // AWS endpoints, VPC endpoints included, are named overrides; their addresses are still judged.
    this.#validate = createSsrfUrlValidator({ ...egress, allowAwsServiceHosts: true });
  }

  /** `egress` is the pull fence; an endpoint override is judged by it, cloud metadata always refused. */
  static create({ egress }: { egress?: GovernanceEgressPolicy } = {}): S3ObjectStoreChannel {
    return new S3ObjectStoreChannel(egress ?? { blockLocal: true, allowedHosts: [] });
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
    return new TextDecoder().decode(await this.readBytes(input));
  }

  async readBytes(input: Parameters<GovernanceObjectStore["readText"]>[0]): Promise<Uint8Array> {
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
      const declared = response.ContentLength;
      if (declared !== undefined && declared > input.maxBytes) {
        throw new Error(`file exceeds ${input.maxBytes} bytes: ${where}`);
      }
      return collectBody({ body: response.Body, declared, input, where });
    });
  }

  async #withClient<T>(
    input: ObjectStoreTarget,
    operation: (client: S3Client) => Promise<T>,
  ): Promise<T> {
    const region = s3RegionOf({ region: input.region, endpoint: input.endpoint });
    const targetHost = input.endpoint ? new URL(input.endpoint).host : defaultS3Host(region);
    // The regional AWS host is reached through the SDK's own resolution; only an override is fenced.
    const pinned =
      input.endpoint === undefined
        ? {}
        : pinnedEndpointConfig(await this.#validate(input.endpoint));
    const { accessKeyId, secretAccessKey, sessionToken, assumeRole, requireStaticKeys } =
      input.credentials;
    const client = new S3Client({
      ...this.#aws.build({
        region,
        endpoint: input.endpoint,
        targetHost,
        staticCredentials: { accessKeyId, secretAccessKey, sessionToken },
        assumeRole: assumeRole ?? null,
        requireStatic: requireStaticKeys === true,
      }),
      ...pinned,
      forcePathStyle: input.endpoint !== undefined,
    });
    try {
      return await operation(client);
    } finally {
      client.destroy();
    }
  }
}

/**
 * The body in one buffer that owns its whole `ArrayBuffer`, so a reader can hand `.buffer` on with
 * no copy. A declared length fills one buffer as chunks arrive; without one the chunks are joined once.
 */
async function collectBody({
  body,
  declared,
  input,
  where,
}: {
  body: AsyncIterable<Uint8Array>;
  declared: number | undefined;
  input: { maxBytes: number; signal?: AbortSignal };
  where: string;
}): Promise<Uint8Array> {
  const filled = declared === undefined ? undefined : new Uint8Array(declared);
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for await (const chunk of body) {
    if (input.signal?.aborted) throw new Error(`aborted while reading ${where}`);
    const end = totalBytes + chunk.byteLength;
    if (end > input.maxBytes || (filled !== undefined && end > filled.byteLength)) {
      throw new Error(`file exceeds ${filled?.byteLength ?? input.maxBytes} bytes: ${where}`);
    }
    if (filled === undefined) chunks.push(chunk);
    else filled.set(chunk, totalBytes);
    totalBytes = end;
  }
  if (filled !== undefined) {
    if (totalBytes !== filled.byteLength) throw new Error(`body ended early: ${where}`);
    return filled;
  }
  const joined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}
