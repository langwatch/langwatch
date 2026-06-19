import type { Cluster, Redis as IORedis } from "ioredis";

import type { JobBlobStore } from "./jobEnvelope";

/**
 * Safety-net TTL for offloaded bodies. Deletion is best-effort at job
 * completion/restage; this bounds how long an orphan (dedup-squashed job,
 * crash between stage and delete) lingers. Must comfortably exceed the
 * longest plausible staged residence — retry backoff chains and paused
 * pipelines hold jobs for hours, not days.
 */
const BLOB_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Stores offloaded envelope bodies as raw gzip binary under standalone keys,
 * read and written directly by the client (never through Lua, so ioredis's
 * UTF-8 script-reply decoding is not a constraint). Keys share the queue
 * name's hash tag so they land in the queue's cluster slot.
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
    this.keyPrefix = `${queueName}:gq:blob:`;
  }

  async put({ id, data }: { id: string; data: Buffer }): Promise<void> {
    await this.redis.set(this.keyPrefix + id, data, "EX", BLOB_TTL_SECONDS);
  }

  async get({ id }: { id: string }): Promise<Buffer | null> {
    return await this.redis.getBuffer(this.keyPrefix + id);
  }

  async delete({ id }: { id: string }): Promise<void> {
    await this.redis.unlink(this.keyPrefix + id);
  }
}
