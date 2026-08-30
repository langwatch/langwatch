import { createLogger } from "@langwatch/observability";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { Anomaly } from "@langwatch/ops-contract";
import type { AnomalyHardTierAlertPort } from "../ports/anomaly-hard-tier-alert.port";
import type { AnomalyRateTrackerPort } from "../ports/anomaly-rate-tracker.port";
import type { AnomalyStatePort } from "../ports/anomaly-state.port";
import { percentile } from "../ops.anomaly-percentile";
import { ANOMALY_DETECTION_KILL_SWITCH_FLAG } from "./anomaly.constants";

const logger = createLogger("langwatch:observability:anomalyDetector");

export const SURFACE_TIER_MULTIPLIER = 10;
export const HARD_TIER_MULTIPLIER = 100;
export const SURFACE_TIER_SUSTAIN_MINUTES = 5;
export const HARD_TIER_SUSTAIN_MINUTES = 15;
export const BASELINE_LOOKBACK_SECONDS = 7 * 24 * 60 * 60;
export const MIN_BASELINE_RATE = 5;
export const INSUFFICIENT_DATA_RECHECK_SECONDS = 10 * 60;

export class AnomalyDetectorService {
  private constructor(
    private readonly rateTracker: AnomalyRateTrackerPort,
    private readonly anomalyState: AnomalyStatePort,
    private readonly featureFlags: FeatureFlagService | undefined,
    private readonly hardTierAlerts: AnomalyHardTierAlertPort | undefined,
  ) {}

  static create(options: {
    rateTracker: AnomalyRateTrackerPort;
    anomalyState: AnomalyStatePort;
    featureFlags?: FeatureFlagService | undefined;
    hardTierAlerts?: AnomalyHardTierAlertPort | undefined;
  }): AnomalyDetectorService {
    return new AnomalyDetectorService(
      options.rateTracker,
      options.anomalyState,
      options.featureFlags,
      options.hardTierAlerts,
    );
  }

  async tick(): Promise<{
    checked: number;
    surfaced: number;
    cleared: number;
    skippedKillSwitch: number;
  }> {
    const tenants = await this.rateTracker.listActiveTenants();
    let surfaced = 0;
    let cleared = 0;
    let skippedKillSwitch = 0;
    for (const tenantId of tenants) {
      const result = await this.evaluateTenant(tenantId);
      if (result === "surfaced") {
        surfaced++;
      }
      if (result === "cleared") {
        cleared++;
      }
      if (result === "killed") {
        skippedKillSwitch++;
      }
    }
    if (surfaced > 0 || cleared > 0 || skippedKillSwitch > 0) {
      logger.info(
        { checked: tenants.length, surfaced, cleared, skippedKillSwitch },
        "AnomalyDetector tick complete",
      );
    }
    return { checked: tenants.length, surfaced, cleared, skippedKillSwitch };
  }

  private async evaluateTenant(
    tenantId: string,
  ): Promise<"surfaced" | "cleared" | "killed" | "noop"> {
    if (await this.isKilledForTenant(tenantId)) {
      return "killed";
    }
    const baseline = await this.resolveBaseline(tenantId);
    if (baseline === null) {
      return "noop";
    }
    const recentSurface = await this.rateTracker.currentWindowCount(
      tenantId,
      SURFACE_TIER_SUSTAIN_MINUTES * 60,
    );
    const surfacePerMin = recentSurface / SURFACE_TIER_SUSTAIN_MINUTES;
    const recentHard = await this.rateTracker.currentWindowCount(
      tenantId,
      HARD_TIER_SUSTAIN_MINUTES * 60,
    );
    const hardPerMin = recentHard / HARD_TIER_SUSTAIN_MINUTES;
    const existing = await this.anomalyState.tryGet(tenantId, "rate_breaker");

    if (hardPerMin >= baseline * HARD_TIER_MULTIPLIER) {
      const anomaly = this.anomaly({
        tenantId,
        baseline,
        rate: hardPerMin,
        tier: "hard",
        existing,
      });
      await this.anomalyState.upsert(anomaly);
      if (this.hardTierAlerts && existing?.tier !== "hard") {
        try {
          await this.hardTierAlerts.notify(anomaly);
        } catch (err) {
          logger.error(
            { tenantId, err: err instanceof Error ? err.message : String(err) },
            "onHardTier callback failed",
          );
        }
      }
      logger.error({ tenantId, currentRate: hardPerMin, baseline }, "HARD-tier rate anomaly");
      return "surfaced";
    }

    if (surfacePerMin >= baseline * SURFACE_TIER_MULTIPLIER) {
      const anomaly = this.anomaly({
        tenantId,
        baseline,
        rate: surfacePerMin,
        tier: "surface",
        existing,
      });
      await this.anomalyState.upsert(anomaly);
      logger.warn({ tenantId, currentRate: surfacePerMin, baseline }, "SURFACE-tier rate anomaly");
      return "surfaced";
    }

    if (existing) {
      await this.anomalyState.clear(tenantId, "rate_breaker");
      logger.info({ tenantId }, "Rate anomaly cleared — back below threshold");
      return "cleared";
    }
    return "noop";
  }

  private anomaly(input: {
    tenantId: string;
    baseline: number;
    rate: number;
    tier: "surface" | "hard";
    existing: Anomaly | null;
  }): Anomaly {
    const sustainMinutes =
      input.tier === "hard" ? HARD_TIER_SUSTAIN_MINUTES : SURFACE_TIER_SUSTAIN_MINUTES;
    return {
      tenantId: input.tenantId,
      kind: "rate_breaker",
      tier: input.tier,
      currentRate: Math.round(input.rate),
      baseline: Math.round(input.baseline),
      triggeredAt: input.existing?.triggeredAt ?? Date.now(),
      reason: `rate ${Math.round(input.rate)}/min is ${Math.round(input.rate / input.baseline)}× baseline ${Math.round(input.baseline)}/min sustained ${sustainMinutes}min`,
    };
  }

  /**
   * The kill switch is per-tenant, so it resolves against the tenant being
   * evaluated. A `system` target carries no identity at all, so a rule naming
   * one project would match nobody and the switch could only ever be
   * all-or-nothing. Resolution failure fails open: a flag outage must not
   * silently disable observability.
   */
  private async isKilledForTenant(tenantId: string): Promise<boolean> {
    if (!this.featureFlags) {
      return false;
    }
    try {
      return await this.featureFlags.isEnabled(ANOMALY_DETECTION_KILL_SWITCH_FLAG, {
        kind: "project",
        projectId: tenantId,
      });
    } catch {
      return false;
    }
  }

  private async resolveBaseline(tenantId: string): Promise<number | null> {
    const cached = await this.rateTracker.tryGetCachedBaseline(tenantId);
    if (cached !== null) {
      return cached < MIN_BASELINE_RATE ? null : cached;
    }
    const series = await this.rateTracker.perMinuteSeries(tenantId, BASELINE_LOOKBACK_SECONDS);
    const nonZero = series.filter((value) => value > 0);
    if (nonZero.length < 60) {
      await this.rateTracker.setCachedBaseline({
        tenantId,
        baseline: 0,
        ttlSeconds: INSUFFICIENT_DATA_RECHECK_SECONDS,
      });
      return null;
    }
    const baseline = percentile({ values: nonZero, p: 95 });
    await this.rateTracker.setCachedBaseline({ tenantId, baseline });
    return baseline < MIN_BASELINE_RATE ? null : baseline;
  }
}
