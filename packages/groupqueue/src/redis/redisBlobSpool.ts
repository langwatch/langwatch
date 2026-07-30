import { createHash } from "node:crypto";
import type { BlobSpool } from "@langwatch/event-sourcing";
import type Redis from "ioredis";
import {
  BlobTooLargeError,
  DurableStoreRequiredError,
  InvalidTenantIdError,
} from "../errors";
import { blobKeys, blobRef } from "./blobKeys";
import { CachedLuaScript } from "./cachedLuaScript";
import { BLOB_PUT_LUA, BLOB_RELEASE_LUA } from "./lua";

/** The durable object store port (ADR-108 decision 9) — deliberately not an
 * S3 client. An adopter wires its own bucket/credentials behind this. */
export interface DurableObjectStore {
  put(key: string, body: string): Promise<void>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}

export const DEFAULT_SPOOL_REDIS_TIER_THRESHOLD_BYTES = 256 * 1024;
export const DEFAULT_SPOOL_MAX_BYTES = 50 * 1024 * 1024;
/** Re-armed on every `put`, so a body still awaiting its first read never
 * expires out from under a slow or paused consumer. */
export const DEFAULT_SPOOL_BACKSTOP_TTL_SECONDS = 4 * 24 * 60 * 60;
/** How long a blob survives its last release before reclamation. */
export const DEFAULT_SPOOL_GRACE_TTL_SECONDS = 60 * 60;

export interface RedisBlobSpoolOptions {
  readonly durableStore?: DurableObjectStore;
  readonly redisTierThresholdBytes?: number;
  readonly maxBytes?: number;
  readonly backstopSeconds?: number;
  readonly graceSeconds?: number;
}

/** SHA-256 truncated to 128 bits, base64url. Identical bytes always hash
 * identically, which is what collapses a fan-out's N copies to one blob. */
export function contentHash(body: string): string {
  return createHash("sha256")
    .update(body)
    .digest()
    .subarray(0, 16)
    .toString("base64url");
}

function assertValidTenantId(tenantId: string): void {
  if (tenantId.length === 0 || /[{}/]/.test(tenantId)) {
    throw new InvalidTenantIdError(tenantId);
  }
}

/** The Redis implementation of `BlobSpool` (ADR-108 decisions 9-10): content-
 * addressed and tenant-namespaced, tiered between an inline Redis value and
 * an injected durable store, refcounted so a fan-out's shared blob outlives
 * every holder but no longer. */
export function redisBlobSpool(
  redis: Redis,
  options: RedisBlobSpoolOptions = {},
): BlobSpool {
  const redisTierThresholdBytes =
    options.redisTierThresholdBytes ?? DEFAULT_SPOOL_REDIS_TIER_THRESHOLD_BYTES;
  const maxBytes = options.maxBytes ?? DEFAULT_SPOOL_MAX_BYTES;
  const backstopSeconds =
    options.backstopSeconds ?? DEFAULT_SPOOL_BACKSTOP_TTL_SECONDS;
  const graceSeconds = options.graceSeconds ?? DEFAULT_SPOOL_GRACE_TTL_SECONDS;
  const putScript = new CachedLuaScript(BLOB_PUT_LUA);
  const releaseScript = new CachedLuaScript(BLOB_RELEASE_LUA);

  return {
    async put(tenantId, body) {
      assertValidTenantId(tenantId);
      const bytes = Buffer.byteLength(body);
      if (bytes > maxBytes) throw new BlobTooLargeError(bytes, maxBytes);

      const ref = blobRef(tenantId, contentHash(body));
      const tier = bytes > redisTierThresholdBytes ? "durable" : "redis";
      const keys = blobKeys(ref);
      const refcount = Number(
        await putScript.run(
          redis,
          2,
          keys.meta,
          keys.data,
          tier,
          tier === "redis" ? body : "",
          String(backstopSeconds),
        ),
      );

      if (tier === "durable" && refcount === 1) {
        if (!options.durableStore) throw new DurableStoreRequiredError(ref);
        await options.durableStore.put(ref, body);
      }
      return ref;
    },

    async get(ref) {
      const keys = blobKeys(ref);
      const tier = await redis.hget(keys.meta, "tier");
      if (tier === null) return null;
      if (tier === "redis") return redis.get(keys.data);
      if (!options.durableStore) throw new DurableStoreRequiredError(ref);
      return options.durableStore.get(ref);
    },

    async release(ref) {
      const keys = blobKeys(ref);
      await releaseScript.run(
        redis,
        2,
        keys.meta,
        keys.data,
        String(graceSeconds),
      );
    },
  };
}
