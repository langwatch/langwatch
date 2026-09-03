import { createLogger } from "@langwatch/observability";
import {
  anomalySchema,
  type Anomaly,
  type AnomalyKind,
  type AnomalyTier,
} from "@langwatch/ops-contract";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { AnomalyStatePort } from "../../ports/anomaly-state.port";

const logger = createLogger("langwatch:observability:anomalyState");

export type { Anomaly, AnomalyKind, AnomalyTier };

/** Redis persistence for active tenant anomalies shown to operators. */
export class RedisAnomalyStateRepository extends AnomalyStatePort {
  private static readonly hashKey = "obs:anomalies";

  private constructor(private readonly redis: IORedis | Cluster) {
    super();
  }

  static create(redis: IORedis | Cluster): RedisAnomalyStateRepository {
    return new RedisAnomalyStateRepository(redis);
  }

  async upsert(anomaly: Anomaly): Promise<void> {
    const field = `${anomaly.kind}:${anomaly.tenantId}`;
    try {
      await this.redis.hset(RedisAnomalyStateRepository.hashKey, field, JSON.stringify(anomaly));
    } catch (err) {
      logger.warn(
        { field, err: err instanceof Error ? err.message : String(err) },
        "AnomalyStateStore.upsert failed",
      );
    }
  }

  async clear(tenantId: string, kind: AnomalyKind): Promise<void> {
    await this.redis.hdel(RedisAnomalyStateRepository.hashKey, `${kind}:${tenantId}`);
  }

  async list(): Promise<Anomaly[]> {
    const raw = await this.redis.hgetall(RedisAnomalyStateRepository.hashKey);
    const anomalies: Anomaly[] = [];
    for (const [, json] of Object.entries(raw)) {
      try {
        anomalies.push(anomalySchema.parse(JSON.parse(json)));
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "AnomalyStateStore: skipping unparseable entry",
        );
      }
    }
    return anomalies;
  }

  async tryGet(tenantId: string, kind: AnomalyKind): Promise<Anomaly | null> {
    const raw = await this.redis.hget(RedisAnomalyStateRepository.hashKey, `${kind}:${tenantId}`);
    if (!raw) {
      return null;
    }

    try {
      return anomalySchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }
}
