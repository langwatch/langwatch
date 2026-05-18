import { createLogger } from "../../utils/logger/server";
import { KILL_SWITCH_CACHE_TTL_MS } from "../featureFlag/constants";
import type { FeatureFlagServiceInterface } from "../featureFlag/types";
import type { Anomaly } from "./anomalyState";
import { AnomalyStateStore } from "./anomalyState";
import {
  ANOMALY_DETECTION_KILL_SWITCH_FLAG,
  TenantRateTracker,
} from "./tenantRateTracker";

const logger = createLogger("langwatch:observability:anomalyDetector");

/**
 * Periodic worker that scans per-tenant enqueue rates and surfaces
 * anomalies on the Ops page. Two tiers, both very high thresholds —
 * a customer scaling up legitimately should never trigger surface tier
 * unless they 10× their normal traffic AND sustain it for 5min.
 *
 *   - Surface (10× baseline, sustained 5min): Ops panel, log warning,
 *     emit Prometheus counter. No automated action.
 *   - Hard (100× baseline, sustained 15min): Ops panel + paged alert.
 *     (Auto-pause hook is plumbed but disabled until the tenant-pause
 *      mechanism lands — see follow-up PR.)
 *
 * Baseline = p95 of per-minute counts across the last 7 days. We use
 * p95 (not mean) so a recent bursty traffic pattern doesn't artificially
 * lift the baseline and mask future spikes. The lookback is intentionally
 * wide so newly-onboarded tenants take time to develop a baseline (no
 * baseline → no anomaly, by design — startup traffic spikes are normal).
 *
 * Cost-shape: the 7-day baseline is cached for 1h in Redis. Tick-time
 * cost for a stable tenant is one HGET; only on cold/stale cache do we
 * do the 10080-field HMGET to recompute p95. At 1000s of tenants this
 * keeps the worker comfortably under the Redis ops budget.
 *
 * Kill switch: per-tenant PostHog flag (see
 * ANOMALY_DETECTION_KILL_SWITCH_FLAG). When set we skip evaluation for
 * that tenant entirely so a single noisy neighbour can be silenced
 * without redeploying.
 */

export const SURFACE_TIER_MULTIPLIER = 10;
export const HARD_TIER_MULTIPLIER = 100;
export const SURFACE_TIER_SUSTAIN_MINUTES = 5;
export const HARD_TIER_SUSTAIN_MINUTES = 15;
export const BASELINE_LOOKBACK_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const MIN_BASELINE_RATE = 5; // skip tenants with <5/min baseline (signal too noisy)

export interface AnomalyDetectorDeps {
  rateTracker: TenantRateTracker;
  anomalyState: AnomalyStateStore;
  featureFlagService?: FeatureFlagServiceInterface;
  onHardTier?: (anomaly: Anomaly) => Promise<void>;
}

export class AnomalyDetector {
  constructor(private readonly deps: AnomalyDetectorDeps) {}

  /** Runs one detection pass across all active tenants. Idempotent. */
  async tick(): Promise<{
    checked: number;
    surfaced: number;
    cleared: number;
    skippedKillSwitch: number;
  }> {
    const tenants = await this.deps.rateTracker.listActiveTenants();
    let surfaced = 0;
    let cleared = 0;
    let skippedKillSwitch = 0;

    for (const tenantId of tenants) {
      const result = await this.evaluateTenant(tenantId);
      if (result === "surfaced") surfaced++;
      if (result === "cleared") cleared++;
      if (result === "killed") skippedKillSwitch++;
    }

    if (surfaced > 0 || cleared > 0 || skippedKillSwitch > 0) {
      logger.info(
        { checked: tenants.length, surfaced, cleared, skippedKillSwitch },
        "AnomalyDetector tick complete",
      );
    }
    return {
      checked: tenants.length,
      surfaced,
      cleared,
      skippedKillSwitch,
    };
  }

  /**
   * Returns true when the per-tenant kill switch is engaged. Failures
   * default to feature-on so PostHog outage never silently disables the
   * anomaly worker.
   */
  private async isKilledForTenant(tenantId: string): Promise<boolean> {
    if (!this.deps.featureFlagService) return false;
    try {
      return await this.deps.featureFlagService.isEnabled(
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

  private async evaluateTenant(
    tenantId: string,
  ): Promise<"surfaced" | "cleared" | "killed" | "noop"> {
    if (await this.isKilledForTenant(tenantId)) {
      return "killed";
    }

    const baseline = await this.resolveBaseline(tenantId);
    if (baseline === null) return "noop";

    const recentSurface = await this.deps.rateTracker.currentWindowCount(
      tenantId,
      SURFACE_TIER_SUSTAIN_MINUTES * 60,
    );
    const surfacePerMin = recentSurface / SURFACE_TIER_SUSTAIN_MINUTES;

    const recentHard = await this.deps.rateTracker.currentWindowCount(
      tenantId,
      HARD_TIER_SUSTAIN_MINUTES * 60,
    );
    const hardPerMin = recentHard / HARD_TIER_SUSTAIN_MINUTES;

    const existing = await this.deps.anomalyState.get(tenantId, "rate_breaker");

    if (hardPerMin >= baseline * HARD_TIER_MULTIPLIER) {
      const anomaly: Anomaly = {
        tenantId,
        kind: "rate_breaker",
        tier: "hard",
        currentRate: Math.round(hardPerMin),
        baseline: Math.round(baseline),
        triggeredAt: existing?.triggeredAt ?? Date.now(),
        reason: `rate ${Math.round(hardPerMin)}/min is ${Math.round(
          hardPerMin / baseline,
        )}× baseline ${Math.round(baseline)}/min sustained ${HARD_TIER_SUSTAIN_MINUTES}min`,
      };
      await this.deps.anomalyState.upsert(anomaly);
      if (this.deps.onHardTier && existing?.tier !== "hard") {
        try {
          await this.deps.onHardTier(anomaly);
        } catch (err) {
          logger.error(
            {
              tenantId,
              err: err instanceof Error ? err.message : String(err),
            },
            "onHardTier callback failed",
          );
        }
      }
      logger.error(
        { tenantId, currentRate: hardPerMin, baseline },
        "HARD-tier rate anomaly",
      );
      return "surfaced";
    }

    if (surfacePerMin >= baseline * SURFACE_TIER_MULTIPLIER) {
      const anomaly: Anomaly = {
        tenantId,
        kind: "rate_breaker",
        tier: "surface",
        currentRate: Math.round(surfacePerMin),
        baseline: Math.round(baseline),
        triggeredAt: existing?.triggeredAt ?? Date.now(),
        reason: `rate ${Math.round(surfacePerMin)}/min is ${Math.round(
          surfacePerMin / baseline,
        )}× baseline ${Math.round(baseline)}/min sustained ${SURFACE_TIER_SUSTAIN_MINUTES}min`,
      };
      await this.deps.anomalyState.upsert(anomaly);
      logger.warn(
        { tenantId, currentRate: surfacePerMin, baseline },
        "SURFACE-tier rate anomaly",
      );
      return "surfaced";
    }

    // Below thresholds: clear any active anomaly
    if (existing) {
      await this.deps.anomalyState.clear(tenantId, "rate_breaker");
      logger.info(
        { tenantId },
        "Rate anomaly cleared — back below threshold",
      );
      return "cleared";
    }
    return "noop";
  }

  /**
   * Return the p95 baseline for a tenant. Uses the 1h Redis cache when
   * fresh; on cache miss does a single 10080-field HMGET, computes the
   * p95, persists it back, and returns it.
   *
   * Returns null when:
   *   - tenant has not yet produced enough activity to form a baseline
   *     (<60 non-zero minutes in the 7-day window)
   *   - resulting baseline is too low to reliably detect anomalies
   *     (<MIN_BASELINE_RATE per minute)
   * In either case the caller should treat the tenant as not-yet-baselined
   * and skip evaluation entirely — this matches the explicit design
   * intent that new tenants ramp without false positives.
   */
  private async resolveBaseline(tenantId: string): Promise<number | null> {
    const cached = await this.deps.rateTracker.getCachedBaseline(tenantId);
    if (cached !== null) {
      // Cached value below the floor still tells us "do not evaluate" —
      // no need to re-scan 10080 fields just to confirm.
      return cached < MIN_BASELINE_RATE ? null : cached;
    }

    const series = await this.deps.rateTracker.perMinuteSeries(
      tenantId,
      BASELINE_LOOKBACK_SECONDS,
    );

    // perMinuteSeries pads missing buckets with 0, so `series.length`
    // always equals the lookback width. Filter to non-zero samples to
    // skip tenants who haven't actually produced traffic.
    const nonZero = series.filter((v) => v > 0);
    if (nonZero.length < 60) {
      // Less than 1h of actual activity — baseline would be noise. Skip,
      // but DON'T cache: we want to re-check soon, not pin "no data"
      // for an hour.
      return null;
    }

    const baseline = percentile({ values: nonZero, p: 95 });
    // Cache whatever we compute (including below-floor values) so the
    // "too-quiet" tenants don't keep paying the HMGET cost every tick.
    await this.deps.rateTracker.setCachedBaseline(tenantId, baseline);
    return baseline < MIN_BASELINE_RATE ? null : baseline;
  }
}

/**
 * Linear-interpolated percentile. Returns 0 for empty input. Sorts a
 * defensive copy so the input array is not mutated.
 */
export function percentile({ values, p }: { values: number[]; p: number }): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower]!;
  const weight = rank - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}
