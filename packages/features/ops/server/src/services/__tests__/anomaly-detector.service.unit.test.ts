import type { Anomaly } from "@langwatch/ops-contract";
import { MemoryFeatureFlagService } from "@langwatch/feature-flag-server/testing";
import type {
  FeatureFlagService,
  FeatureFlagTarget,
} from "@langwatch/feature-flag-contract";
import { describe, expect, it, vi } from "vitest";
import { AnomalyHardTierAlertPort } from "../../ports/anomaly-hard-tier-alert.port";
import { AnomalyRateTrackerPort } from "../../ports/anomaly-rate-tracker.port";
import { AnomalyStatePort } from "../../ports/anomaly-state.port";
import {
  AnomalyDetectorService,
  HARD_TIER_SUSTAIN_MINUTES,
  INSUFFICIENT_DATA_RECHECK_SECONDS,
  SURFACE_TIER_SUSTAIN_MINUTES,
} from "../anomaly-detector.service";
import { ANOMALY_DETECTION_KILL_SWITCH_FLAG } from "../anomaly.constants";
import { percentile } from "../../ops.anomaly-percentile";

/** The tenant a kill-switch resolution was asked about, or none. */
function projectIdOf(target: FeatureFlagTarget): string | undefined {
  return target.kind === "project" ? target.projectId : void 0;
}

class RateTrackerFake extends AnomalyRateTrackerPort {
  readonly baselines = new Map<string, number>();
  readonly listActiveTenants = vi.fn<() => Promise<string[]>>(async () => []);
  readonly currentWindowCount = vi.fn<
    (tenantId: string, seconds: number) => Promise<number>
  >(async () => 0);
  readonly perMinuteSeries = vi.fn<
    (tenantId: string, seconds: number) => Promise<number[]>
  >(async () => []);
  readonly getCachedBaseline = vi.fn<(tenantId: string) => Promise<number | null>>(
    async (tenantId) => this.baselines.get(tenantId) ?? null,
  );
  readonly setCachedBaseline = vi.fn<
    (input: {
      tenantId: string;
      baseline: number;
      ttlSeconds?: number | undefined;
    }) => Promise<void>
  >(async ({ tenantId, baseline }) => {
    this.baselines.set(tenantId, baseline);
  });
}

class AnomalyStateFake extends AnomalyStatePort {
  readonly anomalies = new Map<string, Anomaly>();
  readonly upsert = vi.fn<(anomaly: Anomaly) => Promise<void>>(async (anomaly) => {
    this.anomalies.set(`${anomaly.kind}:${anomaly.tenantId}`, anomaly);
  });
  readonly clear = vi.fn<(tenantId: string, kind: Anomaly["kind"]) => Promise<void>>(
    async (tenantId, kind) => {
      this.anomalies.delete(`${kind}:${tenantId}`);
    },
  );
  readonly tryGet = vi.fn<
    (tenantId: string, kind: Anomaly["kind"]) => Promise<Anomaly | null>
  >(async (tenantId, kind) => this.anomalies.get(`${kind}:${tenantId}`) ?? null);
  readonly list = vi.fn<() => Promise<Anomaly[]>>(async () => [
    ...this.anomalies.values(),
  ]);
}

class HardTierAlertsFake extends AnomalyHardTierAlertPort {
  readonly notify = vi.fn<(anomaly: Anomaly) => Promise<void>>(async () => undefined);
}

function createDetector(
  options: {
    flags?: FeatureFlagService | undefined;
    alerts?: HardTierAlertsFake | undefined;
  } = {},
) {
  const rateTracker = new RateTrackerFake();
  const anomalyState = new AnomalyStateFake();
  const detector = AnomalyDetectorService.create({
    rateTracker,
    anomalyState,
    featureFlags: options.flags,
    hardTierAlerts: options.alerts,
  });
  return { detector, rateTracker, anomalyState };
}

const stableBaseline = Array.from({ length: 100 }, () => 10);

describe("AnomalyDetectorService", () => {
  it("computes a p95 without changing the source sequence", () => {
    const values = [10, 1, 5, 8, 2, 7, 3, 9, 4, 6];
    expect(percentile({ values, p: 95 })).toBeCloseTo(9.55);
    expect(values).toEqual([10, 1, 5, 8, 2, 7, 3, 9, 4, 6]);
  });

  /** @scenario "Insufficient history is cached briefly so quiet tenants are not re-read every tick" */
  it("caches an insufficient-history verdict with its short retry TTL", async () => {
    const { detector, rateTracker, anomalyState } = createDetector();
    rateTracker.listActiveTenants.mockResolvedValue(["proj_new"]);
    rateTracker.perMinuteSeries.mockResolvedValue([5, 10, 5]);

    await detector.tick();

    expect(anomalyState.upsert).not.toHaveBeenCalled();
    expect(rateTracker.setCachedBaseline).toHaveBeenCalledWith({
      tenantId: "proj_new",
      baseline: 0,
      ttlSeconds: INSUFFICIENT_DATA_RECHECK_SECONDS,
    });
  });

  /** @scenario "Baseline cache hit avoids re-scanning the 7-day series" */
  it("uses a warm baseline without rescanning the seven-day series", async () => {
    const { detector, rateTracker } = createDetector();
    rateTracker.baselines.set("proj_acme", 10);
    rateTracker.listActiveTenants.mockResolvedValue(["proj_acme"]);
    rateTracker.currentWindowCount.mockResolvedValue(500);

    await detector.tick();

    expect(rateTracker.perMinuteSeries).not.toHaveBeenCalled();
    expect(rateTracker.setCachedBaseline).not.toHaveBeenCalled();
  });

  /** @scenario "Baseline cache miss triggers a fresh p95 computation and stores it" */
  it("surfaces a rate breaker at the surface threshold", async () => {
    const { detector, rateTracker, anomalyState } = createDetector();
    rateTracker.listActiveTenants.mockResolvedValue(["proj_acme"]);
    rateTracker.perMinuteSeries.mockResolvedValue(stableBaseline);
    rateTracker.currentWindowCount.mockImplementation(async (_tenantId, seconds) => {
      if (seconds === SURFACE_TIER_SUSTAIN_MINUTES * 60) return 500;
      if (seconds === HARD_TIER_SUSTAIN_MINUTES * 60) return 1_500;
      return 0;
    });

    await detector.tick();

    expect(anomalyState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "proj_acme",
        kind: "rate_breaker",
        tier: "surface",
        baseline: 10,
        currentRate: 100,
      }),
    );
  });

  it("notifies once when a hard anomaly first appears", async () => {
    const alerts = new HardTierAlertsFake();
    const { detector, rateTracker, anomalyState } = createDetector({ alerts });
    rateTracker.listActiveTenants.mockResolvedValue(["proj_runaway"]);
    rateTracker.perMinuteSeries.mockResolvedValue(stableBaseline);
    rateTracker.currentWindowCount.mockImplementation(async (_tenantId, seconds) => {
      if (seconds === SURFACE_TIER_SUSTAIN_MINUTES * 60) return 5_000;
      if (seconds === HARD_TIER_SUSTAIN_MINUTES * 60) return 15_000;
      return 0;
    });

    await detector.tick();

    expect(anomalyState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ tier: "hard" }),
    );
    expect(alerts.notify).toHaveBeenCalledTimes(1);
  });

  it("preserves the first trigger time and clears a recovered anomaly", async () => {
    const { detector, rateTracker, anomalyState } = createDetector();
    const triggeredAt = Date.now() - 180_000;
    anomalyState.anomalies.set("rate_breaker:proj_acme", {
      tenantId: "proj_acme",
      kind: "rate_breaker",
      tier: "surface",
      currentRate: 100,
      baseline: 10,
      triggeredAt,
      reason: "first tick",
    });
    rateTracker.listActiveTenants.mockResolvedValue(["proj_acme"]);
    rateTracker.perMinuteSeries.mockResolvedValue(stableBaseline);
    rateTracker.currentWindowCount.mockResolvedValue(500);

    await detector.tick();
    expect(anomalyState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ triggeredAt }),
    );

    rateTracker.currentWindowCount.mockResolvedValue(50);
    await detector.tick();
    expect(anomalyState.clear).toHaveBeenCalledWith("proj_acme", "rate_breaker");
  });

  describe("given the kill-switch flag is resolved per tenant", () => {
    /** @scenario "Kill-switch FF disables anomaly detection for one tenant without a redeploy" */
    it("skips only the tenant the flag names and still evaluates the others", async () => {
      const flags = MemoryFeatureFlagService.create();
      const isEnabled = vi.spyOn(flags, "isEnabled");
      const { detector, rateTracker, anomalyState } = createDetector({ flags });
      rateTracker.listActiveTenants.mockResolvedValue(["proj_killed", "proj_normal"]);
      rateTracker.perMinuteSeries.mockResolvedValue(stableBaseline);
      rateTracker.currentWindowCount.mockResolvedValue(500);
      isEnabled.mockImplementation(
        async (_key, target) => projectIdOf(target) === "proj_killed",
      );

      const result = await detector.tick();

      expect(result.skippedKillSwitch).toBe(1);
      expect(anomalyState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "proj_normal" }),
      );
      expect(anomalyState.upsert).not.toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "proj_killed" }),
      );
    });

    it("carries the evaluated tenant into the flag target", async () => {
      const flags = MemoryFeatureFlagService.create();
      const isEnabled = vi.spyOn(flags, "isEnabled");
      const { detector, rateTracker } = createDetector({ flags });
      rateTracker.listActiveTenants.mockResolvedValue(["proj_acme"]);
      rateTracker.perMinuteSeries.mockResolvedValue(stableBaseline);
      rateTracker.currentWindowCount.mockResolvedValue(500);

      await detector.tick();

      expect(isEnabled).toHaveBeenCalledWith(ANOMALY_DETECTION_KILL_SWITCH_FLAG, {
        kind: "project",
        projectId: "proj_acme",
      });
    });

    /** @scenario "Kill-switch fails open when PostHog is unavailable" */
    it("evaluates the tenant when the flag service throws", async () => {
      const flags = MemoryFeatureFlagService.create();
      const isEnabled = vi.spyOn(flags, "isEnabled");
      const { detector, rateTracker, anomalyState } = createDetector({ flags });
      rateTracker.listActiveTenants.mockResolvedValue(["proj_acme"]);
      rateTracker.perMinuteSeries.mockResolvedValue(stableBaseline);
      rateTracker.currentWindowCount.mockResolvedValue(500);
      isEnabled.mockRejectedValue(new Error("feature flag service unavailable"));

      const result = await detector.tick();

      expect(result.skippedKillSwitch).toBe(0);
      expect(anomalyState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "proj_acme" }),
      );
    });
  });
});
