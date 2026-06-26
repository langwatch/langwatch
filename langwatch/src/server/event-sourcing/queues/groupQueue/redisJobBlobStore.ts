import type { Cluster, Redis as IORedis } from "ioredis";

import { BLOB_BACKSTOP_TTL_SECONDS } from "./blobConstants";
import { redisBlobKeyPrefix } from "./blobKeys";
import type { JobBlobStore } from "./jobEnvelope";

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
    this.keyPrefix = redisBlobKeyPrefix(queueName);
  }

  async put({ id, data }: { id: string; data: Buffer }): Promise<void> {
    await this.redis.set(
      this.keyPrefix + id,
      data,
      "EX",
      BLOB_BACKSTOP_TTL_SECONDS,
    );
  }

  /**
   * Reads the blob and refreshes its TTL (GETEX), so a body still referenced by
   * a long-dwelling job never expires under it. A missing key returns null.
   */
  async get({ id }: { id: string }): Promise<Buffer | null> {
    return await this.redis.getexBuffer(
      this.keyPrefix + id,
      "EX",
      BLOB_BACKSTOP_TTL_SECONDS,
    );
  }

  async delete({ id }: { id: string }): Promise<void> {
    await this.redis.unlink(this.keyPrefix + id);
  }
}
