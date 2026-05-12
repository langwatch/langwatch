import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { createLogger } from "../../utils/logger/server";

const logger = createLogger("langwatch:observability:fingerprintTracker");

/**
 * Per-(tenant, structural fingerprint) rolling rate tracker. Same
 * minute-bucket shape as TenantRateTracker, but keyed additionally by
 * the structural fingerprint of the trace.
 *
 * Bounded memory: the per-tenant fingerprint INDEX caps at 1024
 * distinct fingerprints — past that we drop new fingerprint
 * recordings entirely (existing ones keep updating). This protects
 * against the pathological case of every trace being unique structurally
 * (which itself isn't a loop and shouldn't blow up storage).
 */
export class FingerprintTracker {
  private static readonly RATE_PREFIX = "obs:fp_rate:";
  private static readonly INDEX_PREFIX = "obs:fp_index:";
  private static readonly TOTAL_PREFIX = "obs:fp_total:";
  private static readonly TTL_SECONDS = 8 * 24 * 3600;
  private static readonly MAX_FINGERPRINTS_PER_TENANT = 1024;

  constructor(
    private readonly redis: IORedis | Cluster,
    private readonly nowFn: () => number = Date.now,
  ) {}

  async record(tenantId: string, fingerprint: string): Promise<void> {
    if (!tenantId || !fingerprint) return;
    const minute = Math.floor(this.nowFn() / 60_000);
    const rateKey = `${FingerprintTracker.RATE_PREFIX}${tenantId}:${fingerprint}`;
    const indexKey = `${FingerprintTracker.INDEX_PREFIX}${tenantId}`;
    // Per-tenant total spans-fingerprinted counter (same minute buckets
    // as the per-fingerprint counter so the anomaly detector can divide
    // numerator-by-denominator with both populations matching the same
    // call site — recordSpanCommand at the SpanReceivedEvent emission).
    // Without this, the detector previously divided per-span fp counts
    // by per-group-enqueue tenant volume, biasing share systematically
    // low and breaking the 80% concentration gate.
    const totalKey = `${FingerprintTracker.TOTAL_PREFIX}${tenantId}`;
    try {
      const size = await this.redis.scard(indexKey);
      // Allow updating existing fingerprints even past the cap; only
      // refuse to add NEW ones once full.
      const alreadyKnown = await this.redis.sismember(indexKey, fingerprint);
      if (size >= FingerprintTracker.MAX_FINGERPRINTS_PER_TENANT && !alreadyKnown) {
        return;
      }
      const pipe = this.redis.pipeline();
      pipe.hincrby(rateKey, String(minute), 1);
      pipe.expire(rateKey, FingerprintTracker.TTL_SECONDS);
      pipe.hincrby(totalKey, String(minute), 1);
      pipe.expire(totalKey, FingerprintTracker.TTL_SECONDS);
      pipe.sadd(indexKey, fingerprint);
      pipe.expire(indexKey, FingerprintTracker.TTL_SECONDS);
      await pipe.exec();
    } catch (err) {
      logger.debug(
        {
          tenantId,
          fingerprint,
          err: err instanceof Error ? err.message : String(err),
        },
        "FingerprintTracker.record failed (non-fatal)",
      );
    }
  }

  /**
   * Sum total span-fingerprint recordings for `tenantId` across last
   * `windowSeconds`. Use this — NOT TenantRateTracker — as the
   * denominator when computing fingerprint concentration share. The
   * two trackers count different populations (spans vs group-enqueues).
   */
  async tenantTotalCount(
    tenantId: string,
    windowSeconds: number,
  ): Promise<number> {
    const minuteNow = Math.floor(this.nowFn() / 60_000);
    const minutesBack = Math.max(1, Math.ceil(windowSeconds / 60));
    const fields: string[] = [];
    for (let i = 0; i < minutesBack; i++) {
      fields.push(String(minuteNow - i));
    }
    const key = `${FingerprintTracker.TOTAL_PREFIX}${tenantId}`;
    const values = await this.redis.hmget(key, ...fields);
    let sum = 0;
    for (const v of values) {
      if (!v) continue;
      const n = Number.parseInt(v, 10);
      if (Number.isFinite(n)) sum += n;
    }
    return sum;
  }

  async listFingerprints(tenantId: string): Promise<string[]> {
    return await this.redis.smembers(
      `${FingerprintTracker.INDEX_PREFIX}${tenantId}`,
    );
  }

  /** Sum recordings for `fingerprint` on `tenantId` across last `windowSeconds`. */
  async currentWindowCount(
    tenantId: string,
    fingerprint: string,
    windowSeconds: number,
  ): Promise<number> {
    const minuteNow = Math.floor(this.nowFn() / 60_000);
    const minutesBack = Math.max(1, Math.ceil(windowSeconds / 60));
    const fields: string[] = [];
    for (let i = 0; i < minutesBack; i++) {
      fields.push(String(minuteNow - i));
    }
    const key = `${FingerprintTracker.RATE_PREFIX}${tenantId}:${fingerprint}`;
    const values = await this.redis.hmget(key, ...fields);
    let sum = 0;
    for (const v of values) {
      if (!v) continue;
      const n = Number.parseInt(v, 10);
      if (Number.isFinite(n)) sum += n;
    }
    return sum;
  }
}
