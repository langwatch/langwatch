import type { Cluster, Redis as IORedis } from "ioredis";
import { OpsSnapshotRedisPort } from "../../ports/ops-snapshot-redis.port.ts";

/** The snapshot store's four commands over a live connection. */
export class RedisOpsSnapshotRedisRepository extends OpsSnapshotRedisPort {
  static create(redis: IORedis | Cluster): RedisOpsSnapshotRedisRepository {
    return new RedisOpsSnapshotRedisRepository(redis);
  }

  private constructor(private readonly redis: IORedis | Cluster) {
    super();
  }

  eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown> {
    return this.redis.eval(script, numberOfKeys, ...args);
  }

  set(
    key: string,
    value: string,
    expiryMode: "EX",
    expirySeconds: number,
    condition: "NX",
  ): Promise<unknown> {
    return this.redis.set(key, value, expiryMode, expirySeconds, condition);
  }

  tryGet(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  incr(key: string): Promise<number> {
    return this.redis.incr(key);
  }
}
