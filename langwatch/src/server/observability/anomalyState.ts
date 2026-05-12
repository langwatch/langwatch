import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { createLogger } from "../../utils/logger/server";

const logger = createLogger("langwatch:observability:anomalyState");

export type AnomalyTier = "surface" | "hard";
export type AnomalyKind = "rate_breaker";

export interface Anomaly {
  tenantId: string;
  kind: AnomalyKind;
  tier: AnomalyTier;
  currentRate: number;
  baseline: number;
  triggeredAt: number;
  contributors?: Record<string, number>;
  reason: string;
}

/**
 * Redis-backed store for active tenant anomalies surfaced on the Ops
 * page. Lifecycle:
 *   1. AnomalyDetector worker calls `upsert(anomaly)` each tick when
 *      thresholds are crossed.
 *   2. Ops UI reads via `list()` (server-side, behind tRPC).
 *   3. Operator manually dismisses or anomaly auto-clears when the rate
 *      drops back below threshold (next worker tick calls `clear`).
 *
 * Storage: single Redis HASH `obs:anomalies` keyed by `<kind>:<tenantId>`.
 * No TTL on the hash itself — anomalies are explicitly cleared. The
 * value is a JSON-encoded Anomaly struct.
 */
export class AnomalyStateStore {
  private static readonly HASH_KEY = "obs:anomalies";

  constructor(private readonly redis: IORedis | Cluster) {}

  async upsert(anomaly: Anomaly): Promise<void> {
    const field = `${anomaly.kind}:${anomaly.tenantId}`;
    try {
      await this.redis.hset(
        AnomalyStateStore.HASH_KEY,
        field,
        JSON.stringify(anomaly),
      );
    } catch (err) {
      logger.warn(
        { field, err: err instanceof Error ? err.message : String(err) },
        "AnomalyStateStore.upsert failed",
      );
    }
  }

  async clear(tenantId: string, kind: AnomalyKind): Promise<void> {
    const field = `${kind}:${tenantId}`;
    await this.redis.hdel(AnomalyStateStore.HASH_KEY, field);
  }

  async list(): Promise<Anomaly[]> {
    const raw = await this.redis.hgetall(AnomalyStateStore.HASH_KEY);
    const out: Anomaly[] = [];
    for (const [, json] of Object.entries(raw)) {
      try {
        const parsed = JSON.parse(json) as Anomaly;
        out.push(parsed);
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "AnomalyStateStore: skipping unparseable entry",
        );
      }
    }
    return out;
  }

  async get(tenantId: string, kind: AnomalyKind): Promise<Anomaly | null> {
    const field = `${kind}:${tenantId}`;
    const raw = await this.redis.hget(AnomalyStateStore.HASH_KEY, field);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Anomaly;
    } catch {
      return null;
    }
  }
}
