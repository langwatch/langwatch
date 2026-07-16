import type { Cluster, Redis as IORedis } from "ioredis";

import { GQ1_BLOB_BACKSTOP_TTL_SECONDS } from "./blobConstants";
import { redisBlobKeyPrefix } from "./blobKeys";
import type { JobBlobStore } from "./jobEnvelope";

/**
 * Stores offloaded envelope bodies as raw gzip binary under standalone keys,
 * read and written directly by the client (never through Lua, so ioredis's
 * UTF-8 script-reply decoding is not a constraint). Keys share the queue
 * name's hash tag so they land in the queue's cluster slot.
 *
 * A staged-but-not-yet-dispatched job (long retry backoff, paused pipeline,
 * delayed schedule) sees NO intervening read between the producer's `put` and
 * the dispatcher's `get`, so the DEFAULT TTL is set to comfortably outlive the
 * longest plausible staged residence (7 days, see
 * {@link GQ1_BLOB_BACKSTOP_TTL_SECONDS}). GQ2 callers pass their own shorter
 * backstop per call: a refcounted blob reclaims eagerly on the last release,
 * so its TTL only has to cover genuine orphans, not staged residence.
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
      ttlSeconds ?? GQ1_BLOB_BACKSTOP_TTL_SECONDS,
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
      ttlSeconds ?? GQ1_BLOB_BACKSTOP_TTL_SECONDS,
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

  /**
   * Extends the blob's TTL without reading it (#719/#720). Used when a
   * body-present value is dead-lettered: the DLQ quarantine (7 days) outlives
   * this store's default backstop, so the referenced blob must be pushed to at
   * least the quarantine window or the dead-letter would point at a gone blob.
   * A no-op if the key has already expired (`EXPIRE` returns 0).
   */
  async refreshTtl({
    id,
    ttlSeconds,
  }: {
    id: string;
    ttlSeconds: number;
  }): Promise<void> {
    await this.redis.expire(this.keyPrefix + id, ttlSeconds);
  }
}
