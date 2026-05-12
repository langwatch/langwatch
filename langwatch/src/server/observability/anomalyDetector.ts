import { createLogger } from "../../utils/logger/server";
import type { Anomaly } from "./anomalyState";
import { AnomalyStateStore } from "./anomalyState";
import { FingerprintTracker } from "./fingerprintTracker";
import { TenantRateTracker } from "./tenantRateTracker";

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
 */

export const SURFACE_TIER_MULTIPLIER = 10;
export const HARD_TIER_MULTIPLIER = 100;
export const SURFACE_TIER_SUSTAIN_MINUTES = 5;
export const HARD_TIER_SUSTAIN_MINUTES = 15;
export const BASELINE_LOOKBACK_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const MIN_BASELINE_RATE = 5; // skip tenants with <5/min baseline (signal too noisy)

// Fingerprint-loop thresholds. Designed to NOT trigger on legitimately
// homogeneous workloads (regression suites, cron jobs) which stay at
// modest absolute rates. Triggers when one structural shape both
// dominates the tenant's volume AND is firing at thousands/min.
export const FINGERPRINT_CONCENTRATION_THRESHOLD = 0.8; // >= 80% of tenant volume
export const FINGERPRINT_MIN_RATE_PER_MIN = 100; // absolute floor
export const FINGERPRINT_WINDOW_MINUTES = 5;

export interface AnomalyDetectorDeps {
  rateTracker: TenantRateTracker;
  fingerprintTracker?: FingerprintTracker;
  anomalyState: AnomalyStateStore;
  onHardTier?: (anomaly: Anomaly) => Promise<void>;
}

export class AnomalyDetector {
  constructor(private readonly deps: AnomalyDetectorDeps) {}

  /** Runs one detection pass across all active tenants. Idempotent. */
  async tick(): Promise<{ checked: number; surfaced: number; cleared: number }> {
    const tenants = await this.deps.rateTracker.listActiveTenants();
    let surfaced = 0;
    let cleared = 0;

    for (const tenantId of tenants) {
      const result = await this.evaluateTenant(tenantId);
      if (result === "surfaced") surfaced++;
      if (result === "cleared") cleared++;

      if (this.deps.fingerprintTracker) {
        const fpResult = await this.evaluateFingerprints(tenantId);
        if (fpResult === "surfaced") surfaced++;
        if (fpResult === "cleared") cleared++;
      }
    }

    if (surfaced > 0 || cleared > 0) {
      logger.info(
        { checked: tenants.length, surfaced, cleared },
        "AnomalyDetector tick complete",
      );
    }
    return { checked: tenants.length, surfaced, cleared };
  }

  private async evaluateTenant(
    tenantId: string,
  ): Promise<"surfaced" | "cleared" | "noop"> {
    // Surface tier check: 5-min window rate vs baseline
    const series = await this.deps.rateTracker.perMinuteSeries(
      tenantId,
      BASELINE_LOOKBACK_SECONDS,
    );

    if (series.length < 60) {
      // Insufficient data for a baseline (less than 1h of history). Skip.
      return "noop";
    }

    const baseline = percentile(series.filter((v) => v > 0), 95);
    if (baseline < MIN_BASELINE_RATE) {
      // Too quiet to reliably detect anomalies.
      return "noop";
    }

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
   * Fingerprint-loop check: per tenant, identify any structural fingerprint
   * that is both (a) firing at >= FINGERPRINT_MIN_RATE_PER_MIN AND (b)
   * represents >= FINGERPRINT_CONCENTRATION_THRESHOLD of the tenant's
   * 5-min volume. Catches the 2026-05-11 loop pattern: one workflow shape
   * dominates the tenant's traffic at thousands/min.
   */
  private async evaluateFingerprints(
    tenantId: string,
  ): Promise<"surfaced" | "cleared" | "noop"> {
    const fpTracker = this.deps.fingerprintTracker;
    if (!fpTracker) return "noop";

    const windowSec = FINGERPRINT_WINDOW_MINUTES * 60;
    // Use the FingerprintTracker's own per-tenant total — matches the
    // call site (recordSpanCommand). The TenantRateTracker counts
    // per-group-enqueue across the whole pipeline (fold writes, reactor
    // outputs, dispatch commands, ...) so dividing fp counts by it
    // biases share low and the 80% gate would silently never fire.
    const tenantTotal = await fpTracker.tenantTotalCount(tenantId, windowSec);
    if (tenantTotal === 0) {
      const existing = await this.deps.anomalyState.get(tenantId, "fingerprint_loop");
      if (existing) {
        await this.deps.anomalyState.clear(tenantId, "fingerprint_loop");
        return "cleared";
      }
      return "noop";
    }

    const fps = await fpTracker.listFingerprints(tenantId);
    let worstFp: { fp: string; count: number } | null = null;
    for (const fp of fps) {
      const count = await fpTracker.currentWindowCount(tenantId, fp, windowSec);
      if (!worstFp || count > worstFp.count) {
        worstFp = { fp, count };
      }
    }
    if (!worstFp) return "noop";

    const ratePerMin = worstFp.count / FINGERPRINT_WINDOW_MINUTES;
    const share = worstFp.count / tenantTotal;
    const existing = await this.deps.anomalyState.get(tenantId, "fingerprint_loop");

    if (
      ratePerMin >= FINGERPRINT_MIN_RATE_PER_MIN &&
      share >= FINGERPRINT_CONCENTRATION_THRESHOLD
    ) {
      const anomaly: Anomaly = {
        tenantId,
        kind: "fingerprint_loop",
        // Fingerprint loops always surface; hard-tier is reserved for the
        // rate breaker which has a clearer "automatable response" path.
        tier: "surface",
        currentRate: Math.round(ratePerMin),
        baseline: 0,
        triggeredAt: existing?.triggeredAt ?? Date.now(),
        contributors: { [worstFp.fp.substring(0, 12)]: Math.round(share * 100) },
        reason: `fingerprint ${worstFp.fp.substring(0, 12)} is ${Math.round(
          share * 100,
        )}% of tenant volume at ${Math.round(ratePerMin)}/min (>=${FINGERPRINT_CONCENTRATION_THRESHOLD * 100}% concentration AND >=${FINGERPRINT_MIN_RATE_PER_MIN}/min)`,
      };
      await this.deps.anomalyState.upsert(anomaly);
      logger.warn(
        { tenantId, fp: worstFp.fp, share, ratePerMin },
        "fingerprint-loop anomaly surfaced",
      );
      return "surfaced";
    }

    if (existing) {
      await this.deps.anomalyState.clear(tenantId, "fingerprint_loop");
      return "cleared";
    }
    return "noop";
  }
}

/**
 * Linear-interpolated percentile. Sorts in place; pass a defensive copy
 * when the caller cares about ordering. Returns 0 for empty input.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower]!;
  const weight = rank - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}
