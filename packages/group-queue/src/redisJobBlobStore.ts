import type { Cluster, Redis as IORedis } from "ioredis";

import { BLOB_BACKSTOP_TTL_SECONDS } from "./blobConstants";
import { redisBlobKeyPrefix } from "./blobKeys";
import type { JobBlobStore } from "./jobEnvelope";

/**
 * Stores offloaded envelope bodies as raw gzip binary under standalone keys,
 * read and written directly by the client (never through Lua, so ioredis's
 * UTF-8 script-reply decoding is not a constraint). Keys share the queue
 * name's hash tag so they land in the queue's cluster slot.
 *
 * Every stored body is content addressed. Its renewable lease is the liveness
 * signal and the TTL is the final safety net when a holder disappears.
 */
export class RedisJobBlobStore implements JobBlobStore {
  private readonly redis: IORedis | Cluster;
  private readonly keyPrefix: string;

  constructor({
    redis,
    queueName,
  }: {
    redis: IORedis | Cluster;
    queueName: string;
  }) {
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
    await this.redis.set(
      this.keyPrefix + id,
      data,
      "EX",
      ttlSeconds ?? BLOB_BACKSTOP_TTL_SECONDS,
    );
  }

  /**
   * Reads the blob and refreshes its TTL (GETEX). Worker hot path only — see
   * {@link peek} for the inspection path that must NOT extend the backstop TTL.
   * A missing key returns null.
   */
  async get({
    id,
    ttlSeconds,
  }: {
    id: string;
    ttlSeconds?: number;
  }): Promise<Buffer | null> {
    return await this.redis.getexBuffer(
      this.keyPrefix + id,
      "EX",
      ttlSeconds ?? BLOB_BACKSTOP_TTL_SECONDS,
    );
  }

  /**
   * Reads the blob WITHOUT refreshing its TTL. Use from the ops dashboard and
   * any other non-worker inspection path so a repeatedly-viewed blocked group
   * doesn't keep its orphan blobs alive indefinitely (2026-06-24 review).
   * A missing key returns null.
   */
  async peek({ id }: { id: string }): Promise<Buffer | null> {
    return await this.redis.getBuffer(this.keyPrefix + id);
  }

  async delete({ id }: { id: string }): Promise<void> {
    await this.redis.unlink(this.keyPrefix + id);
  }
}
