import { createLogger } from "@langwatch/observability";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { AnomalyRateTrackerPort } from "../ports/anomaly-rate-tracker.port";
import { ANOMALY_DETECTION_KILL_SWITCH_FLAG } from "../services/anomaly.constants";

const logger = createLogger("langwatch:observability:tenantRateTracker");

export class RedisTenantRateTrackerAdapter extends AnomalyRateTrackerPort {
  private static readonly keyPrefix = "obs:tenant_rate:";
  private static readonly activeSet = "obs:tenant_rate:active";
  private static readonly baselinePrefix = "obs:tenant_rate:baseline:";
  private static readonly ttlSeconds = 8 * 24 * 3600;
  private static readonly retentionMinutes =
    RedisTenantRateTrackerAdapter.ttlSeconds / 60;
  private static readonly trimBatch = 500;
  static readonly baselineTtlSeconds = 60 * 60;

  private constructor(
    private readonly redis: IORedis | Cluster,
    private readonly now: () => number,
    private readonly featureFlags: FeatureFlagService | undefined,
  ) {
    super();
  }

  static create(options: {
    redis: IORedis | Cluster;
    now?: (() => number) | undefined;
    featureFlags?: FeatureFlagService | undefined;
  }): RedisTenantRateTrackerAdapter {
    return new RedisTenantRateTrackerAdapter(
      options.redis,
      options.now ?? Date.now,
      options.featureFlags,
    );
  }

  async record(tenantId: string, count = 1): Promise<void> {
    if (!tenantId) {
      return;
    }

    if (await this.isKilledForTenant(tenantId)) {
      return;
    }

    const minute = Math.floor(this.now() / 60_000);
    const key = `${RedisTenantRateTrackerAdapter.keyPrefix}${tenantId}`;

    try {
      const pipe = this.redis.pipeline();
      pipe.hincrby(key, String(minute), count);
      pipe.hdel(key, String(minute - RedisTenantRateTrackerAdapter.retentionMinutes));
      pipe.expire(key, RedisTenantRateTrackerAdapter.ttlSeconds);
      pipe.sadd(RedisTenantRateTrackerAdapter.activeSet, tenantId);
      pipe.expire(
        RedisTenantRateTrackerAdapter.activeSet,
        RedisTenantRateTrackerAdapter.ttlSeconds,
      );
      await pipe.exec();
    } catch (err) {
      logger.debug(
        { tenantId, err: err instanceof Error ? err.message : String(err) },
        "TenantRateTracker.record failed (non-fatal)",
      );
    }
  }

  async currentWindowCount(tenantId: string, windowSeconds: number): Promise<number> {
    const minuteNow = Math.floor(this.now() / 60_000);
    const minutesBack = Math.max(1, Math.ceil(windowSeconds / 60));
    const fields = Array.from({ length: minutesBack }, (_, index) =>
      String(minuteNow - index),
    );
    const values = await this.redis.hmget(
      `${RedisTenantRateTrackerAdapter.keyPrefix}${tenantId}`,
      ...fields,
    );

    let sum = 0;
    for (const value of values) {
      if (!value) {
        continue;
      }

      const count = Number.parseInt(value, 10);
      if (Number.isFinite(count)) {
        sum += count;
      }
    }

    return sum;
  }

  async perMinuteSeries(tenantId: string, lookbackSeconds: number): Promise<number[]> {
    const minuteNow = Math.floor(this.now() / 60_000);
    const minutesBack = Math.max(1, Math.ceil(lookbackSeconds / 60));
    const oldestMinute = minuteNow - (minutesBack - 1);
    const retentionCutoff = minuteNow - RedisTenantRateTrackerAdapter.retentionMinutes;
    const key = `${RedisTenantRateTrackerAdapter.keyPrefix}${tenantId}`;
    const entries = await this.redis.hgetall(key);
    const series = Array.from({ length: minutesBack }, () => 0);
    const staleFields: string[] = [];

    for (const [field, value] of Object.entries(entries)) {
      const minute = Number.parseInt(field, 10);
      if (!Number.isFinite(minute)) {
        continue;
      }

      if (minute < retentionCutoff) {
        staleFields.push(field);
        continue;
      }

      const index = minute - oldestMinute;
      if (index < 0 || index >= minutesBack) {
        continue;
      }

      series[index] = Number.parseInt(value, 10) || 0;
    }

    await this.trimStaleFields(key, staleFields);

    return series;
  }

  async listActiveTenants(): Promise<string[]> {
    return await this.redis.smembers(RedisTenantRateTrackerAdapter.activeSet);
  }

  async getCachedBaseline(tenantId: string): Promise<number | null> {
    try {
      const raw = await this.redis.get(
        `${RedisTenantRateTrackerAdapter.baselinePrefix}${tenantId}`,
      );
      if (!raw) {
        return null;
      }

      const baseline = Number.parseFloat(raw);

      return Number.isFinite(baseline) ? baseline : null;
    } catch (err) {
      logger.debug(
        { tenantId, err: err instanceof Error ? err.message : String(err) },
        "TenantRateTracker.getCachedBaseline failed (non-fatal)",
      );
      return null;
    }
  }

  async setCachedBaseline(input: {
    tenantId: string;
    baseline: number;
    ttlSeconds?: number | undefined;
  }): Promise<void> {
    try {
      await this.redis.set(
        `${RedisTenantRateTrackerAdapter.baselinePrefix}${input.tenantId}`,
        input.baseline.toString(),
        "EX",
        input.ttlSeconds ?? RedisTenantRateTrackerAdapter.baselineTtlSeconds,
      );
    } catch (err) {
      logger.debug(
        {
          tenantId: input.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        "TenantRateTracker.setCachedBaseline failed (non-fatal)",
      );
    }
  }

  private async isKilledForTenant(tenantId: string): Promise<boolean> {
    if (!this.featureFlags) {
      return false;
    }

    try {
      return await this.featureFlags.isEnabled(ANOMALY_DETECTION_KILL_SWITCH_FLAG, {
        kind: "system",
      });
    } catch {
      return false;
    }
  }

  private async trimStaleFields(key: string, fields: string[]): Promise<void> {
    if (fields.length === 0) {
      return;
    }

    try {
      for (
        let index = 0;
        index < fields.length;
        index += RedisTenantRateTrackerAdapter.trimBatch
      ) {
        await this.redis.hdel(
          key,
          ...fields.slice(index, index + RedisTenantRateTrackerAdapter.trimBatch),
        );
      }
    } catch (err) {
      logger.debug(
        { key, err: err instanceof Error ? err.message : String(err) },
        "TenantRateTracker.perMinuteSeries trim failed (non-fatal)",
      );
    }
  }
}
