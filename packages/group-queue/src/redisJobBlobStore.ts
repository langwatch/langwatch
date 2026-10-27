import type { Cluster, Redis as IORedis } from "ioredis";

import { BLOB_BACKSTOP_TTL_SECONDS } from "./blobConstants.ts";
import { redisBlobKeyPrefix } from "./blobKeys.ts";
import type { JobBlobStore } from "./jobEnvelope.ts";

/**
 * Content-addressed gzip storage for envelope bodies; client-direct reads/writes
 * (no Lua). Renewable leases signal liveness; TTL is final safety net.
 */
export class RedisJobBlobStore implements JobBlobStore {
  private readonly redis: IORedis | Cluster;
  private readonly keyPrefix: string;

  constructor({ redis, queueName }: { redis: IORedis | Cluster; queueName: string }) {
    this.redis = redis;
    this.keyPrefix = redisBlobKeyPrefix(queueName);
  }

  async put({
    id,
    data,
    ttlSeconds,
  }: {
    id: string;
    data: Buffer;
    ttlSeconds?: number;
  }): Promise<void> {
    await this.redis.set(this.keyPrefix + id, data, "EX", ttlSeconds ?? BLOB_BACKSTOP_TTL_SECONDS);
  }

  /**
   * Reads the blob and refreshes its TTL (GETEX). Worker hot path only — see
   * {@link peek} for the inspection path that must NOT extend the backstop TTL.
   * A missing key returns null.
   */
  async get({ id, ttlSeconds }: { id: string; ttlSeconds?: number }): Promise<Buffer | null> {
    return this.redis.getexBuffer(
      this.keyPrefix + id,
      "EX",
      ttlSeconds ?? BLOB_BACKSTOP_TTL_SECONDS,
    );
  }

  /**
   * Reads the blob WITHOUT refreshing its TTL — for the ops dashboard and
   * other non-worker inspection, so a repeatedly-viewed blocked group can't
   * keep its orphan blobs alive indefinitely (2026-06-24). Missing key returns null.
   */
  async peek({ id }: { id: string }): Promise<Buffer | null> {
    return this.redis.getBuffer(this.keyPrefix + id);
  }

  async delete({ id }: { id: string }): Promise<void> {
    await this.redis.unlink(this.keyPrefix + id);
  }
}
