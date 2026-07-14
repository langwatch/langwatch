import { createHash } from "node:crypto";
import type { Readable } from "node:stream";

import type { Logger } from "@langwatch/telemetry";

import { COMMAND_INLINE_THRESHOLD } from "~/server/app-layer/traces/lean-for-projection";
import type { TenantId } from "~/server/event-sourcing/domain/tenantId";
import type { ProjectStorageDestination } from "~/server/stored-objects/project-storage-destination";
import { mintFileUri, mintS3Uri } from "~/server/stored-objects/uri";

import { BLOB_BACKSTOP_TTL_SECONDS, MAX_BLOB_BYTES } from "./blobConstants";
import { blobNamespaceId } from "./blobKeys";
import type { JobBlobStore } from "./jobEnvelope";
import { gqBlobDecodeCapExceededTotal } from "./metrics";

/**
 * Minimal object-store surface the durable (s3/file) tier needs. Structurally
 * satisfied by the stored-objects `StorageRegistry`, so this tier reuses the
 * codebase's one pluggable object store rather than adding another. See
 * ADR-029.
 */
export interface ObjectStore {
  put(uri: string, bytes: Buffer, mediaType: string): Promise<void>;
  get(uri: string): Promise<Readable>;
  delete(uri: string): Promise<void>;
}

/**
 * Above this serialized size a blob lives in the durable object store; at or
 * below it, in Redis. Derived from `COMMAND_INLINE_THRESHOLD` (ADR-022's
 * edge-spool boundary) so a retune on that constant moves both sides in
 * lockstep. The inline tier (≤ a few KiB) is handled by the envelope, not
 * this store.
 */
export const S3_TIER_THRESHOLD_BYTES = COMMAND_INLINE_THRESHOLD;

/**
 * A content-addressed reference to an offloaded blob; travels inside the job
 * envelope in place of the bytes. Both tiers carry only (projectId, hash) — the
 * read location is re-derived from these server-trusted inputs (the redis key /
 * a re-minted s3 uri), never trusted from a stored uri, so a tampered envelope
 * can't redirect a read across tenants (ADR-030 §5).
 */
export type BlobRef =
  | { tier: "redis"; projectId: TenantId; hash: string }
  | { tier: "s3"; projectId: TenantId; hash: string };

/**
 * A blob fetch failed for a reason that is NOT "the object is gone" — a network
 * blip, a 5xx, a destination-resolve failure. The job must retry (the body is
 * only temporarily unreachable), never drop to replay as if the blob were
 * missing; that distinction is what stops a transient store outage from
 * mass-dropping every in-flight offloaded job (ADR-030 §2).
 */
export class TransientBlobStoreError extends Error {
  readonly projectId: TenantId;
  readonly hash: string;
  constructor({
    projectId,
    hash,
    cause,
  }: {
    projectId: TenantId;
    hash: string;
    cause: unknown;
  }) {
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
  return createHash("sha256")
    .update(bytes)
    .digest()
    .subarray(0, 16)
    .toString("base64url");
}

function redisBlobId(params: { projectId: TenantId; hash: string }): string {
  return blobNamespaceId(params);
}

/** A stored object exceeded the read cap — treated as a corrupt/missing blob, not a transient error. */
class BlobTooLargeError extends Error {}

/** Buffers a stream, capped at `maxBytes` so a tampered/oversized object can't OOM the worker. */
async function streamToBuffer(
  stream: Readable,
  maxBytes: number,
): Promise<Buffer> {
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
 * Content-addressed, tenant-namespaced blob store with two durable tiers: Redis
 * for mid-size bodies, the reused stored-objects object store for very large
 * ones. Keys are namespaced by `projectId` (the tenant id) so tenants never
 * share a blob and a project purge is a delete-by-prefix. See ADR-029.
 *
 * Dependencies are injected (no env coupling) so the store is exercised in
 * isolation: `objectStore` is satisfied by `StorageRegistry`, `resolveDestination`
 * by `resolveProjectStorageDestination`.
 */
export class TieredBlobStore {
  private readonly redisBlobs: JobBlobStore;
  // Per-project so the s3/file tier resolves each tenant's BYOC bucket and
  // credentials (the stored-objects S3Driver is projectId-scoped).
  private readonly objectStoreFor: (projectId: string) => ObjectStore;
  private readonly resolveDestination: (
    projectId: string,
  ) => Promise<ProjectStorageDestination>;
  private readonly s3ThresholdBytes: number;
  private readonly queueName?: string;
  private readonly logger?: Logger;
  // Per-project storage destination, cached for the process lifetime. BYOC
  // bucket changes are rare deliberate migrations, picked up on the next worker
  // restart (deploys are frequent); a failed resolve is not cached.
  private readonly destinationCache = new Map<
    TenantId,
    Promise<ProjectStorageDestination>
  >();

  constructor(deps: {
    redisBlobs: JobBlobStore;
    objectStoreFor: (projectId: string) => ObjectStore;
    resolveDestination: (
      projectId: string,
    ) => Promise<ProjectStorageDestination>;
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
    // Silent-fail-if-unset was the original ADR-030 issue Aryan flagged — this
    // makes the omission visible instead of latent (2026-07-03 audit follow-up).
    // Test doubles construct without queueName; we only warn when a logger is
    // available so tests stay quiet.
    if (!this.queueName && this.logger) {
      this.logger.warn(
        "TieredBlobStore constructed without queueName — decode-cap counter and warn will silently no-op",
      );
    }
  }

  private resolveDestinationCached(
    projectId: TenantId,
  ): Promise<ProjectStorageDestination> {
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
    switch (destination.kind) {
      case "s3":
        return mintS3Uri({
          bucket: destination.bucket,
          projectId,
          sha256: hash,
        });
      case "file":
        return mintFileUri({ root: destination.root, projectId, sha256: hash });
      default: {
        const unhandled: never = destination;
        throw new Error(
          `Unhandled storage destination kind: ${JSON.stringify(unhandled)}`,
        );
      }
    }
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
     * historical `application/gzip` for callers that don't compress with
     * anything else; a caller writing zstd (or another codec) must pass the
     * matching media type so durable storage isn't mislabeled.
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
    // GQ2 blobs are refcounted (holder-set eager reclaim), so the TTL is only
    // the orphan backstop — 4 days, not GQ1's 7-day staged-residence window.
    await this.redisBlobs.put({
      id: redisBlobId({ projectId, hash }),
      data,
      ttlSeconds: BLOB_BACKSTOP_TTL_SECONDS,
    });
    return { tier: "redis", projectId, hash };
  }

  /**
   * Returns null when a blob is genuinely gone (key absent, or a durable-store
   * "not found"). A client-side failure on either tier (connection drop,
   * timeout, OOM rejection, network 5xx) throws {@link TransientBlobStoreError}
   * instead, so the caller retries rather than treating a blip as "missing".
   */
  async get(ref: BlobRef): Promise<Buffer | null> {
    return this.fetch(ref, /* refresh */ true);
  }

  /**
   * Reads a blob WITHOUT refreshing its backstop TTL — the non-worker /
   * ops-dashboard inspection path. Symmetric with {@link RedisJobBlobStore.peek}
   * so a repeatedly-viewed blocked group can't extend the lifetime of its
   * orphan blobs indefinitely by triggering GETEX on every render.
   * S3-tier objects have no TTL; peek and get are functionally identical there.
   */
  async peek(ref: BlobRef): Promise<Buffer | null> {
    return this.fetch(ref, /* refresh */ false);
  }

  private async fetch(ref: BlobRef, refresh: boolean): Promise<Buffer | null> {
    if (ref.tier === "redis") {
      const id = redisBlobId({ projectId: ref.projectId, hash: ref.hash });
      // A redis-tier miss is represented by a null return (GETEX/GET on an
      // absent key), never an exception — so any exception here is the
      // client itself (connection drop, command timeout, OOM-from-noeviction
      // rejection), not "the blob is gone". Treat it as transient (retry),
      // mirroring the s3 branch below, instead of letting it fall through to
      // the decode fail-safe and permanently drop a job over a blip
      // (2026-07-11 incident: uncaught ioredis errors here were indistinguishable
      // from a genuinely missing blob).
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
    // failure is transient (retry), never "missing" (ADR-030 §2).
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
      // A genuinely-absent or oversized/corrupt object is a missing blob → null
      // → decode fail-safe (recover via replay). Anything else (network/5xx) is
      // transient and must retry, not drop the job (ADR-030 §2). Oversize is
      // an OBSERVABLE fail-safe — split from "just missing" so oncall can see a
      // real tamper / zip-bomb event distinct from "TTL reclaimed the blob".
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
   * Deletes a blob. A redis-tier blob is normally reclaimed inside the holder
   * Lua (UNLINK in the same eval as the last release); this method is the
   * general-purpose / out-of-band delete — the s3 reclaim path, or a direct
   * caller holding a ref — so it handles both tiers.
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
