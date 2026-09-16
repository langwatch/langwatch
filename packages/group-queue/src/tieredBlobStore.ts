import { createHash } from "node:crypto";
import type { Readable } from "node:stream";

import type { Logger } from "@langwatch/observability";

import { BLOB_BACKSTOP_TTL_SECONDS, MAX_BLOB_BYTES } from "./blobConstants.ts";
import { blobNamespaceId } from "./blobKeys.ts";
import type { JobBlobStore } from "./jobEnvelope.ts";
import { gqBlobDecodeCapExceededTotal } from "./metrics.ts";
import {
  mintUriForDestination,
  type ObjectStore,
  type ProjectStorageDestination,
  type TenantId,
} from "./storage.ts";

export type { ObjectStore } from "./storage.ts";

/**
 * Above this size a blob lives in the durable object store; at or below, in
 * Redis. Derived from `COMMAND_INLINE_THRESHOLD` (ADR-022) so retuning that
 * constant moves both sides in lockstep. The inline tier is the envelope's, not this store's.
 */
export const S3_TIER_THRESHOLD_BYTES = 256 * 1024;

/**
 * Content-addressed blob reference (projectId, hash); tier indicates location
 * (redis/s3), never provider. Read location re-derived per operation (ADR-029).
 */
export type BlobRef =
  | { tier: "redis"; projectId: TenantId; hash: string }
  | { tier: "s3"; projectId: TenantId; hash: string };

/**
 * A blob fetch failed for a reason that is NOT "the object is gone" (network
 * blip, 5xx, destination-resolve failure). The job must retry, never drop to
 * replay as missing — that's what stops an outage mass-dropping in-flight jobs (ADR-029).
 */
export class TransientBlobStoreError extends Error {
  readonly projectId: TenantId;
  readonly hash: string;
  constructor({ projectId, hash, cause }: { projectId: TenantId; hash: string; cause: unknown }) {
    super(`Transient blob store error for ${projectId}/${hash}`, { cause });
    this.name = "TransientBlobStoreError";
    this.projectId = projectId;
    this.hash = hash;
  }
}

/**
 * SHA-256 of the bytes truncated to 128 bits, base64url (~22 chars). Collision
 * probability is negligible; identical bytes always hash identically, which is
 * what collapses a fan-out's N copies to a single stored blob.
 */
export function contentHash(bytes: Buffer | string): string {
  // `update(string)` handles UTF-8 encoding internally without allocating a
  // full-payload Buffer — for a 4 MiB fan-out payload the caller passing the
  // string directly saves 4 MiB of throw-away allocation on the encode hot path.
  return createHash("sha256").update(bytes).digest().subarray(0, 16).toString("base64url");
}

function redisBlobId(params: { projectId: TenantId; hash: string }): string {
  return blobNamespaceId(params);
}

/** Stored object exceeded read cap; treated as corrupt/missing, not transient error. */
class BlobTooLargeError extends Error {}

/** Buffers a stream, capped at `maxBytes` so a tampered/oversized object can't OOM the worker. */
async function streamToBuffer(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Buffer);
    total += buf.length;
    if (total > maxBytes) {
      stream.destroy();
      throw new BlobTooLargeError(`Stored blob exceeds ${maxBytes} bytes`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/** Whether an object-store error means the object is absent (vs a transient failure). */
function isObjectMissingError(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const e = err as {
    name?: string;
    code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    e.name === "NoSuchKey" ||
    e.name === "NotFound" ||
    e.code === "ENOENT" ||
    e.code === "NoSuchKey" ||
    e.$metadata?.httpStatusCode === 404
  );
}

/**
 * Tenant-namespaced dual-tier blob store: Redis for mid-size bodies,
 * stored-objects for large ones. Dependencies injected for isolated testing.
 */
export class TieredBlobStore {
  private readonly redisBlobs: JobBlobStore;
  // Per-project so the s3/file tier resolves each tenant's BYOC bucket and
  // credentials (the stored-objects S3Driver is projectId-scoped).
  private readonly objectStoreFor: (projectId: string) => ObjectStore;
  private readonly resolveDestination: (projectId: string) => Promise<ProjectStorageDestination>;
  private readonly s3ThresholdBytes: number;
  private readonly queueName?: string;
  private readonly logger?: Logger;
  // Per-project storage destination, cached for the process lifetime. BYOC
  // bucket changes are rare deliberate migrations, picked up on the next worker
  // restart (deploys are frequent); a failed resolve is not cached.
  private readonly destinationCache = new Map<TenantId, Promise<ProjectStorageDestination>>();

  constructor(deps: {
    redisBlobs: JobBlobStore;
    objectStoreFor: (projectId: string) => ObjectStore;
    resolveDestination: (projectId: string) => Promise<ProjectStorageDestination>;
    s3ThresholdBytes?: number;
    /** Optional queue name for the decode-cap-exceeded counter. */
    queueName?: string;
    /** Optional logger for the decode-cap-exceeded warn. */
    logger?: Logger;
  }) {
    this.redisBlobs = deps.redisBlobs;
    this.objectStoreFor = deps.objectStoreFor;
    this.resolveDestination = deps.resolveDestination;
    this.s3ThresholdBytes = deps.s3ThresholdBytes ?? S3_TIER_THRESHOLD_BYTES;
    this.queueName = deps.queueName;
    this.logger = deps.logger;
    // Loud one-time warn when observability isn't wired at composition time.
    // A missing object-store binding is a configuration error — this
    // makes the omission visible instead of latent (2026-07-03 audit follow-up).
    // Test doubles construct without queueName; we only warn when a logger is
    // available so tests stay quiet.
    if (!this.queueName && this.logger) {
      this.logger.warn(
        "TieredBlobStore constructed without queueName — decode-cap counter and warn will silently no-op",
      );
    }
  }

  private resolveDestinationCached(projectId: TenantId): Promise<ProjectStorageDestination> {
    let cached = this.destinationCache.get(projectId);
    if (!cached) {
      cached = this.resolveDestination(projectId).catch((err: unknown) => {
        this.destinationCache.delete(projectId); // don't cache a transient failure
        throw err;
      });
      this.destinationCache.set(projectId, cached);
    }
    return cached;
  }

  /** Re-derives the object uri from (projectId, hash) — never trusts a stored uri. */
  private async mintUri({
    projectId,
    hash,
  }: {
    projectId: TenantId;
    hash: string;
  }): Promise<string> {
    const destination = await this.resolveDestinationCached(projectId);
    return mintUriForDestination({
      destination,
      objectPath: `${projectId}/${hash}`,
    });
  }

  async put({
    projectId,
    data,
    hashSource,
    mediaType = "application/gzip",
  }: {
    projectId: TenantId;
    data: Buffer;
    /**
     * Bytes to derive the content hash from — the RAW source, so the dedup key
     * doesn't depend on gzip determinism (zlib version/level). Defaults to
     * `data`, i.e. hash exactly what is stored.
     */
    hashSource?: Buffer | string;
    /**
     * Media type stored alongside the s3-tier object. Defaults to the
     * historical `application/gzip`; a caller writing zstd (or another codec)
     * must pass the matching type so durable storage isn't mislabeled.
     */
    mediaType?: string;
  }): Promise<BlobRef> {
    const hash = contentHash(hashSource ?? data);
    if (data.length > this.s3ThresholdBytes) {
      const uri = await this.mintUri({ projectId, hash });
      // Idempotent: identical content mints the same URI, so a racing or retried
      // PUT overwrites the same object instead of duplicating it.
      await this.objectStoreFor(projectId).put(uri, data, mediaType);
      return { tier: "s3", projectId, hash };
    }
    // GQ2 Redis blobs reclaim lazily when their renewable lease/backstop window
    // goes untouched and keeps the normal backstop.
    await this.redisBlobs.put({
      id: redisBlobId({ projectId, hash }),
      data,
      ttlSeconds: BLOB_BACKSTOP_TTL_SECONDS,
    });
    return { tier: "redis", projectId, hash };
  }

  /**
   * Returns null when a blob is genuinely gone (key absent, or a durable-
   * store "not found"). Any client-side failure instead throws
   * {@link TransientBlobStoreError}, so the caller retries rather than treating a blip as missing.
   */
  async get(ref: BlobRef): Promise<Buffer | null> {
    return this.fetch(ref, /* refresh */ true);
  }

  /**
   * Reads a blob WITHOUT refreshing its backstop TTL — the inspection path,
   * so a repeatedly-viewed blocked group can't extend orphan blobs' lifetime
   * via GETEX on every render. S3 objects have no TTL, so peek equals get there.
   */
  async peek(ref: BlobRef): Promise<Buffer | null> {
    return this.fetch(ref, /* refresh */ false);
  }

  private async fetch(ref: BlobRef, refresh: boolean): Promise<Buffer | null> {
    if (ref.tier === "redis") {
      const id = redisBlobId({ projectId: ref.projectId, hash: ref.hash });
      // A redis-tier miss is a null return (GETEX/GET), never an exception —
      // any exception here is the client itself (drop, timeout, OOM), not
      // "gone". Treat it as transient like the s3 branch (2026-07-11: uncaught
      // ioredis errors here were indistinguishable from a genuinely missing blob).
      try {
        return await (refresh
          ? this.redisBlobs.get({ id, ttlSeconds: BLOB_BACKSTOP_TTL_SECONDS })
          : this.redisBlobs.peek({ id }));
      } catch (err) {
        throw new TransientBlobStoreError({
          projectId: ref.projectId,
          hash: ref.hash,
          cause: err,
        });
      }
    }
    // Re-mint OUTSIDE the missing-classification: a destination-resolve / mint
    // failure is transient (retry), never "missing" (ADR-029).
    let uri: string;
    try {
      uri = await this.mintUri({ projectId: ref.projectId, hash: ref.hash });
    } catch (err) {
      throw new TransientBlobStoreError({
        projectId: ref.projectId,
        hash: ref.hash,
        cause: err,
      });
    }
    try {
      return await streamToBuffer(
        await this.objectStoreFor(ref.projectId).get(uri),
        MAX_BLOB_BYTES,
      );
    } catch (err) {
      // A genuinely-absent or oversized/corrupt object → null → decode
      // fail-safe, which DISCARDS the job permanently (#5538: replay never
      // re-invokes subscribers). Anything else (network/5xx) is transient and
      // must retry, not drop (ADR-029). Oversize stays observable, distinct from "just missing".
      if (err instanceof BlobTooLargeError) {
        if (this.queueName) {
          gqBlobDecodeCapExceededTotal.inc({ queue_name: this.queueName });
        }
        if (this.logger) {
          this.logger.warn(
            {
              projectId: ref.projectId,
              blobHash: ref.hash,
              cap: MAX_BLOB_BYTES,
            },
            "Blob exceeds decode cap — possible tamper / zip-bomb; treating as missing",
          );
        }
        return null;
      }
      if (isObjectMissingError(err)) {
        return null;
      }
      throw new TransientBlobStoreError({
        projectId: ref.projectId,
        hash: ref.hash,
        cause: err,
      });
    }
  }

  /**
   * Explicitly deletes a blob for administrative/direct callers. GQ2 lease
   * release and transfer paths never call this; normal reclaim is lazy.
   */
  async delete(ref: BlobRef): Promise<void> {
    if (ref.tier === "redis") {
      await this.redisBlobs.delete({
        id: redisBlobId({ projectId: ref.projectId, hash: ref.hash }),
      });
      return;
    }
    const uri = await this.mintUri({
      projectId: ref.projectId,
      hash: ref.hash,
    });
    await this.objectStoreFor(ref.projectId).delete(uri);
  }
}
