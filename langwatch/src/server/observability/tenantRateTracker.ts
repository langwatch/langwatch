import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { createLogger } from "../../utils/logger/server";
import { KILL_SWITCH_CACHE_TTL_MS } from "../featureFlag/constants";
import type { FeatureFlagServiceInterface } from "../featureFlag/types";

const logger = createLogger("langwatch:observability:tenantRateTracker");

/**
 * PostHog feature-flag key. When this flag is enabled for a given
 * tenant (or globally) the rate-tracker `record()` write becomes a
 * no-op and the AnomalyWorker tick skips that tenant. Toggle in seconds
 * via PostHog if anomaly detection ever causes load issues on Redis.
 */
export const ANOMALY_DETECTION_KILL_SWITCH_FLAG =
  "es-observability-anomaly-detection-killswitch";

/** Distinct ID used when checking the kill switch at the GLOBAL scope. */
export const GLOBAL_KILL_SWITCH_DISTINCT_ID = "global";

/**
 * Per-tenant rolling enqueue-rate tracker.
 *
 * Post-2026-05-11 incident follow-up: surfaces tenants whose event-sourcing
 * group-creation rate has spiked far above their normal baseline. The
 * 2026-05-11 outage was caused by one tenant producing ~95% of all groups
 * after an evaluator-recursion loop, starving every other tenant. With
 * this tracker + the AnomalyDetector worker, we would have flagged the
 * runaway pattern within minutes instead of after a customer-perceived
 * outage.
 *
 * Storage model:
 *  - `obs:tenant_rate:<tenantId>` is a Redis HASH whose fields are
 *    minute-truncated unix timestamps (in seconds) and whose values are
 *    the count of enqueues in that minute.
 *  - HASH TTL of ~8 days ensures stale tenant tracking auto-purges and
 *    bounds memory.
 *  - The active-tenants index `obs:tenant_rate:active` is a SET — fast
 *    SMEMBERS for the periodic anomaly sweep, no key SCAN required.
 *  - `obs:tenant_rate:baseline:<tenantId>` caches the computed p95
 *    baseline for ~1h so the worker tick does not redo the full-series
 *    HGETALL for every tenant every minute.
 *
 * Why minute-bucketed (not per-event ZSET):
 *  - O(1) write per enqueue (HINCRBY) vs O(log N) for ZADD with random nonce
 *  - Memory bounded by `minute_count × tenant_count`, not by event count
 *  - ~12 KiB per tenant per week at 1Hz baseline (vs MBs of ZSET nonces)
 *  - 1-minute resolution is sufficient — we alert on 5-min sustained spikes
 */
export class TenantRateTracker {
  private static readonly KEY_PREFIX = "obs:tenant_rate:";
  private static readonly ACTIVE_SET = "obs:tenant_rate:active";
  private static readonly BASELINE_PREFIX = "obs:tenant_rate:baseline:";
  private static readonly TTL_SECONDS = 8 * 24 * 3600; // 8 days
  /**
   * Retention window in minutes (== the key TTL). A minute field older than
   * this is past the point any reader looks at and only inflates the HGETALL
   * reply, so it is trimmed both on write (the field aging out this tick) and
   * on read (any orphan older than the window — including hashes that grew
   * unbounded before trimming existed). Bounds the hash at ~one field per
   * active minute over the window.
   */
  private static readonly RETENTION_MINUTES = TenantRateTracker.TTL_SECONDS / 60;
  /**
   * Batch size for the on-read orphan trim. A hash that predates trimming can
   * hold hundreds of thousands of fields; delete them in chunks so a single
   * HDEL command never carries a pathological arg list.
   */
  private static readonly TRIM_BATCH = 500;
  /**
   * Baseline cache TTL. The p95 of a 7-day window does not move
   * meaningfully in an hour — caching this is the single biggest
   * tick-cost reduction available, dropping per-tenant tick cost from
   * one full-series HGETALL to one HGET.
   */
  public static readonly BASELINE_TTL_SECONDS = 60 * 60; // 1h

  constructor(
    private readonly redis: IORedis | Cluster,
    private readonly nowFn: () => number = Date.now,
    private readonly featureFlagService?: FeatureFlagServiceInterface,
  ) {}

  /**
   * Returns true when the kill-switch FF is enabled for this tenant (or
   * globally). The 60s TTL of `isComponentDisabled` means the worst-case
   * stampede on PostHog is one /flags request per tenant per minute when
   * local evaluation is unavailable, and a per-process map lookup
   * otherwise. Hot-path safe.
   *
   * Failures default to "feature on" so PostHog outage never silently
   * kills observability.
   */
  private async isKilledForTenant(tenantId: string): Promise<boolean> {
    if (!this.featureFlagService) return false;
    try {
      return await this.featureFlagService.isEnabled(
        ANOMALY_DETECTION_KILL_SWITCH_FLAG,
        {
          distinctId: tenantId,
          defaultValue: false,
          cacheTtlMs: KILL_SWITCH_CACHE_TTL_MS,
        },
      );
    } catch {
      return false;
    }
  }

  /**
   * Record a single enqueue against a tenant. Called from the GroupQueue
   * send() / sendBatch() hot path — must be O(1), non-blocking on errors.
   * Failures are logged at debug level and swallowed so observability
   * never breaks production traffic.
   */
  async record(tenantId: string, count = 1): Promise<void> {
    if (!tenantId) return;
    if (await this.isKilledForTenant(tenantId)) return;
    const minute = Math.floor(this.nowFn() / 60_000);
    const key = `${TenantRateTracker.KEY_PREFIX}${tenantId}`;
    try {
      // ioredis pipelines auto-batch for both standalone and cluster modes
      const pipe = this.redis.pipeline();
      pipe.hincrby(key, String(minute), count);
      // Drop the field aging out of the window this tick. The key TTL is
      // refreshed below on every write, so an active tenant's key never
      // expires — without this trim the hash would accumulate one field per
      // active minute forever and HGETALL would grow without bound.
      pipe.hdel(key, String(minute - TenantRateTracker.RETENTION_MINUTES));
      pipe.expire(key, TenantRateTracker.TTL_SECONDS);
      pipe.sadd(TenantRateTracker.ACTIVE_SET, tenantId);
      pipe.expire(TenantRateTracker.ACTIVE_SET, TenantRateTracker.TTL_SECONDS);
      await pipe.exec();
    } catch (err) {
      logger.debug(
        { tenantId, err: err instanceof Error ? err.message : String(err) },
        "TenantRateTracker.record failed (non-fatal)",
      );
    }
  }

  /**
   * Sum enqueues for `tenantId` across the last `windowSeconds` window.
   * Returns 0 when the tenant has no data.
   */
  async currentWindowCount(
    tenantId: string,
    windowSeconds: number,
  ): Promise<number> {
    const minuteNow = Math.floor(this.nowFn() / 60_000);
    const minutesBack = Math.max(1, Math.ceil(windowSeconds / 60));
    const fields: string[] = [];
    for (let i = 0; i < minutesBack; i++) {
      fields.push(String(minuteNow - i));
    }
    const key = `${TenantRateTracker.KEY_PREFIX}${tenantId}`;
    const values = await this.redis.hmget(key, ...fields);
    let sum = 0;
    for (const v of values) {
      if (!v) continue;
      const n = Number.parseInt(v, 10);
      if (Number.isFinite(n)) sum += n;
    }
    return sum;
  }

  /**
   * Per-minute rates across the last `lookbackSeconds`. Sorted oldest-first,
   * zero-padded for silent minutes. Used by the anomaly detector to compute
   * rolling p95 baselines without fetching unbounded data.
   *
   * Reads via HGETALL, not an HMGET enumerating every minute of the window:
   * the hash only holds minutes with activity, so HGETALL's cost scales with
   * the tenant's actual traffic, while a 7-day window HMGET forced Redis to
   * look up 10,080 requested fields (~1.8 ms of engine CPU each) regardless
   * of how sparse the hash was — measured as the single largest engine-CPU
   * consumer on prod (2026-07-09). The hash is trimmed to the retention
   * window on both write and read (see {@link RETENTION_MINUTES}), so it
   * holds at most one field per active minute over that window and the reply
   * can never exceed ~11.5k fields however long the tenant stays active.
   */
  async perMinuteSeries(
    tenantId: string,
    lookbackSeconds: number,
  ): Promise<number[]> {
    const minuteNow = Math.floor(this.nowFn() / 60_000);
    const minutesBack = Math.max(1, Math.ceil(lookbackSeconds / 60));
    const oldestMinute = minuteNow - (minutesBack - 1);
    const retentionCutoff = minuteNow - TenantRateTracker.RETENTION_MINUTES;
    const key = `${TenantRateTracker.KEY_PREFIX}${tenantId}`;
    const entries = await this.redis.hgetall(key);
    const series = new Array<number>(minutesBack).fill(0);
    const staleFields: string[] = [];
    for (const [field, value] of Object.entries(entries)) {
      const minute = Number.parseInt(field, 10);
      if (!Number.isFinite(minute)) continue;
      if (minute < retentionCutoff) {
        staleFields.push(field);
        continue;
      }
      const index = minute - oldestMinute;
      if (index < 0 || index >= minutesBack) continue;
      series[index] = Number.parseInt(value, 10) || 0;
    }
    await this.trimStaleFields(key, staleFields);
    return series;
  }

  /**
   * Best-effort removal of minute fields that have aged past the retention
   * window. Trim-on-write keeps a steadily-active tenant bounded, but a hash
   * that grew before trimming existed (or a tenant with silent gaps) can
   * still carry orphans older than the window; the anomaly tick already reads
   * the whole hash, so it cleans them up here. Batched so a single HDEL never
   * carries a pathological arg list, and swallowed on error so a cleanup
   * hiccup never fails the baseline read.
   */
  private async trimStaleFields(key: string, fields: string[]): Promise<void> {
    if (fields.length === 0) return;
    try {
      for (let i = 0; i < fields.length; i += TenantRateTracker.TRIM_BATCH) {
        const batch = fields.slice(i, i + TenantRateTracker.TRIM_BATCH);
        await this.redis.hdel(key, ...batch);
      }
    } catch (err) {
      logger.debug(
        { key, err: err instanceof Error ? err.message : String(err) },
        "TenantRateTracker.perMinuteSeries trim failed (non-fatal)",
      );
    }
  }

  /**
   * Returns all tenants we have rate data for. The anomaly worker iterates
   * this list every tick.
   */
  async listActiveTenants(): Promise<string[]> {
    return await this.redis.smembers(TenantRateTracker.ACTIVE_SET);
  }

  /**
   * Read a previously-cached baseline for this tenant. Returns null when
   * none cached or unparseable. Single HGET — cheap to call every tick.
   */
  async getCachedBaseline(tenantId: string): Promise<number | null> {
    try {
      const raw = await this.redis.get(
        `${TenantRateTracker.BASELINE_PREFIX}${tenantId}`,
      );
      if (!raw) return null;
      const n = Number.parseFloat(raw);
      return Number.isFinite(n) ? n : null;
    } catch (err) {
      logger.debug(
        { tenantId, err: err instanceof Error ? err.message : String(err) },
        "TenantRateTracker.getCachedBaseline failed (non-fatal)",
      );
      return null;
    }
  }

  /**
   * Persist a fresh baseline with the standard 1h TTL (or a caller-chosen
   * shorter one — the detector caches its "not enough data yet" verdict
   * briefly so quiet tenants don't re-pay the full-series read every tick).
   * Called once per tenant per tick at most when the cache is cold or stale.
   */
  async setCachedBaseline({
    tenantId,
    baseline,
    ttlSeconds = TenantRateTracker.BASELINE_TTL_SECONDS,
  }: {
    tenantId: string;
    baseline: number;
    ttlSeconds?: number;
  }): Promise<void> {
    try {
      await this.redis.set(
        `${TenantRateTracker.BASELINE_PREFIX}${tenantId}`,
        baseline.toString(),
        "EX",
        ttlSeconds,
      );
    } catch (err) {
      logger.debug(
        { tenantId, err: err instanceof Error ? err.message : String(err) },
        "TenantRateTracker.setCachedBaseline failed (non-fatal)",
      );
    }
  }
}

/**
 * Extract the tenant prefix from an event-sourcing groupId (everything
 * before the first `/`). Returns null when the groupId has no slash.
 *
 * WARNING: this is convention, not enforced. Today every groupId
 * producer happens to put the tenantId first, and DISPATCH_LUA also
 * relies on this exact parse. A future cross-tenant groupId (or any
 * group that doesn't follow the prefix rule) would silently land in
 * the wrong bucket here — the right long-term fix is to document the
 * "groupId MUST start with <tenantId>/ OR a global prefix" rule on the
 * GroupQueue producer surface, then make this function fail loudly
 * when violated. Tracked as a code smell to revisit when we touch
 * groupId formatting next.
 */
export function tenantIdFromGroupId(groupId: string): string | null {
  if (!groupId) return null;
  const idx = groupId.indexOf("/");
  if (idx <= 0) return null;
  return groupId.substring(0, idx);
}
