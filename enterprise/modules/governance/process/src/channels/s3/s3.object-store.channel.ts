// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { lookup as dnsLookup } from "node:dns";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { isIP, type LookupFunction } from "node:net";

import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { AwsClientConfiguration, defaultS3Host, s3RegionOf } from "@langwatch/aws-client";
import {
  createSsrfUrlValidator,
  type SsrfUrlValidator,
  type SsrfValidationResult,
} from "@langwatch/egress";
import { NodeHttpHandler, type NodeHttpHandlerOptions } from "@smithy/node-http-handler";

import type { GovernanceEgressPolicy } from "../http/http.governance-http.channel.ts";
import type {
  GovernanceObjectStorageCredentials,
  GovernanceObjectStore,
} from "../object-store.channel.ts";

const MAX_S3_FILES = 100;
const PINNED_CONNECTION_TIMEOUT_MS = 5_000;
const PINNED_REQUEST_TIMEOUT_MS = 20_000;
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

/** A DNS lookup that answers every name with the one address the egress fence judged. */
export function pinnedLookup(ip: string): LookupFunction {
  const family = isIP(ip) === 6 ? 6 : 4;
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address: ip, family }]);
    else callback(null, ip, family);
  };
}

/** The address the egress fence judged for one host; a host it could not resolve is refused. */
function judgedAddressOf(validated: SsrfValidationResult): string {
  const ip = validated.type === "unresolved" ? undefined : validated.resolvedIp;
  if (!ip || isIP(ip) === 0) {
    throw new Error(`endpoint ${validated.hostname} did not resolve to an address to pin`);
  }
  return ip;
}

/** A DNS lookup that answers each judged host with its address and resolves any other name normally. */
export function pinnedHostsLookup(addresses: ReadonlyMap<string, string>): LookupFunction {
  return (hostname, options, callback) => {
    const ip = addresses.get(hostname.toLowerCase());
    if (ip === undefined) return dnsLookup(hostname, options, callback);
    return pinnedLookup(ip)(hostname, options, callback);
  };
}

/** The shared AWS client's deadlines, enforced: a stalled custom endpoint fails instead of hanging. */
export function pinnedHandlerOptions(lookup: LookupFunction): NodeHttpHandlerOptions {
  return {
    httpAgent: new HttpAgent({ lookup }),
    httpsAgent: new HttpsAgent({ lookup }),
    connectionTimeout: PINNED_CONNECTION_TIMEOUT_MS,
    requestTimeout: PINNED_REQUEST_TIMEOUT_MS,
    throwOnRequestTimeout: true,
  };
}

function handlerFor(lookup: LookupFunction): { requestHandler: NodeHttpHandler } {
  return { requestHandler: new NodeHttpHandler(pinnedHandlerOptions(lookup)) };
}

/**
 * A request handler for a customer-supplied endpoint that dials only the judged address, so a
 * name that resolves elsewhere at connect time (DNS rebinding) cannot reach a refused host. The
 * Host header and the TLS servername keep the original name.
 */
export function pinnedEndpointConfig(validated: SsrfValidationResult): {
  requestHandler: NodeHttpHandler;
} {
  return handlerFor(pinnedLookup(judgedAddressOf(validated)));
}

/** Pins every judged host to its own address; names the fence did not judge resolve normally. */
export function pinnedHostsConfig(validated: readonly SsrfValidationResult[]): {
  requestHandler?: NodeHttpHandler;
} {
  if (validated.length === 0) return {};
  const addresses = new Map(
    validated.map((result) => [result.hostname.toLowerCase(), judgedAddressOf(result)] as const),
  );
  return handlerFor(pinnedHostsLookup(addresses));
}
