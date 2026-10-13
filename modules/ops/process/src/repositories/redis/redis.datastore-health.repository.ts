import type { RedisConnection } from "@langwatch/redis-client";
import type { Redis } from "ioredis";

import { RedisHealthRepository } from "../datastore-health.repository.ts";

/** Whether Redis answers, and where the connection points. */
export class RedisRedisHealthRepository extends RedisHealthRepository {
  private constructor(private readonly redis: RedisConnection) {
    super();
  }

  static create(redis: RedisConnection): RedisRedisHealthRepository {
    return new RedisRedisHealthRepository(redis);
  }

  describeTarget(): string {
    if (!isStandalone(this.redis)) return "the configured Redis cluster";
    const { host, port } = this.redis.options;
    return `${host ?? "localhost"}:${port ?? 6379}`;
  }

  async ping(): Promise<void> {
    await this.redis.ping();
  }
}

function isStandalone(connection: RedisConnection): connection is Redis {
  return !connection.isCluster;
}
