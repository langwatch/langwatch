import { describe, expect, it, vi } from "vitest";
import {
  AnomalyDetector,
  HARD_TIER_MULTIPLIER,
  HARD_TIER_SUSTAIN_MINUTES,
  MIN_BASELINE_RATE,
  SURFACE_TIER_MULTIPLIER,
  SURFACE_TIER_SUSTAIN_MINUTES,
  percentile,
} from "../anomalyDetector";
import type { Anomaly } from "../anomalyState";

function makeFakes() {
  const stored = new Map<string, Anomaly>();
  return {
    rateTracker: {
      listActiveTenants: vi.fn().mockResolvedValue([]),
      currentWindowCount: vi.fn().mockResolvedValue(0),
      perMinuteSeries: vi.fn().mockResolvedValue([]),
    } as any,
    anomalyState: {
      upsert: vi.fn().mockImplementation(async (a: Anomaly) => {
        stored.set(`${a.kind}:${a.tenantId}`, a);
      }),
      clear: vi.fn().mockImplementation(async (tid: string, kind: string) => {
        stored.delete(`${kind}:${tid}`);
      }),
      get: vi
        .fn()
        .mockImplementation(async (tid: string, kind: string) =>
          stored.get(`${kind}:${tid}`) ?? null,
        ),
      list: vi.fn().mockResolvedValue([]),
    } as any,
    stored,
  };
}

describe("percentile", () => {
  it("returns 0 for empty", () => {
    expect(percentile([], 95)).toBe(0);
  });

  it("returns the value for single-element", () => {
    expect(percentile([42], 95)).toBe(42);
  });

  it("computes p95 with linear interpolation", () => {
    const series = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(series, 95)).toBeCloseTo(95.05, 1);
  });

  it("is order-independent (sorts internally)", () => {
    const a = [10, 1, 5, 8, 2, 7, 3, 9, 4, 6];
    const b = [...a].reverse();
    expect(percentile(a, 50)).toBeCloseTo(percentile(b, 50));
  });
});

describe("AnomalyDetector.tick", () => {
  it("skips tenants with insufficient history (<60 minutes of data)", async () => {
    const fakes = makeFakes();
    fakes.rateTracker.listActiveTenants.mockResolvedValue(["proj_new"]);
    fakes.rateTracker.perMinuteSeries.mockResolvedValue([5, 10, 5]); // 3 minutes

    const detector = new AnomalyDetector(fakes);
    const result = await detector.tick();

    expect(result.surfaced).toBe(0);
    expect(fakes.anomalyState.upsert).not.toHaveBeenCalled();
  });

  it("skips tenants with very quiet baseline (below MIN_BASELINE_RATE)", async () => {
    const fakes = makeFakes();
    fakes.rateTracker.listActiveTenants.mockResolvedValue(["proj_quiet"]);
    // 60+ minutes, but max value is 2 → p95 < MIN_BASELINE_RATE (5)
    fakes.rateTracker.perMinuteSeries.mockResolvedValue(
      Array.from({ length: 70 }, () => 1),
    );
    fakes.rateTracker.currentWindowCount.mockResolvedValue(1000);

    const detector = new AnomalyDetector(fakes);
    const result = await detector.tick();

    expect(result.surfaced).toBe(0);
    expect(fakes.anomalyState.upsert).not.toHaveBeenCalled();
  });

  it("surfaces a surface-tier anomaly when rate is 10× baseline", async () => {
    const fakes = makeFakes();
    fakes.rateTracker.listActiveTenants.mockResolvedValue(["proj_acme"]);
    // Stable baseline of 10/min
    fakes.rateTracker.perMinuteSeries.mockResolvedValue(
      Array.from({ length: 100 }, () => 10),
    );
    // 5-min window: 10× baseline = 100/min → 500 over 5min
    fakes.rateTracker.currentWindowCount.mockImplementation(
      async (_t: string, sec: number) => {
        if (sec === SURFACE_TIER_SUSTAIN_MINUTES * 60) return 500;
        if (sec === HARD_TIER_SUSTAIN_MINUTES * 60) return 1500;
        return 0;
      },
    );

    const detector = new AnomalyDetector(fakes);
    const result = await detector.tick();

    expect(result.surfaced).toBe(1);
    expect(fakes.anomalyState.upsert).toHaveBeenCalled();
    const arg = fakes.anomalyState.upsert.mock.calls[0]![0] as Anomaly;
    expect(arg.kind).toBe("rate_breaker");
    expect(arg.tier).toBe("surface");
    expect(arg.baseline).toBe(10);
    expect(arg.currentRate).toBe(100);
  });

  it("surfaces a hard-tier anomaly when rate is 100× baseline (15min sustained)", async () => {
    const fakes = makeFakes();
    fakes.rateTracker.listActiveTenants.mockResolvedValue(["proj_runaway"]);
    fakes.rateTracker.perMinuteSeries.mockResolvedValue(
      Array.from({ length: 100 }, () => 10),
    );
    // 15-min window: 100× baseline = 1000/min → 15_000 over 15min
    fakes.rateTracker.currentWindowCount.mockImplementation(
      async (_t: string, sec: number) => {
        if (sec === SURFACE_TIER_SUSTAIN_MINUTES * 60) return 5000;
        if (sec === HARD_TIER_SUSTAIN_MINUTES * 60) return 15_000;
        return 0;
      },
    );

    const onHardTier = vi.fn().mockResolvedValue(undefined);
    const detector = new AnomalyDetector({ ...fakes, onHardTier });
    await detector.tick();

    const arg = fakes.anomalyState.upsert.mock.calls[0]![0] as Anomaly;
    expect(arg.tier).toBe("hard");
    expect(onHardTier).toHaveBeenCalledTimes(1);
  });

  it("clears an active anomaly when rate drops back below threshold", async () => {
    const fakes = makeFakes();
    // Pre-existing surface anomaly
    fakes.stored.set("rate_breaker:proj_acme", {
      tenantId: "proj_acme",
      kind: "rate_breaker",
      tier: "surface",
      currentRate: 100,
      baseline: 10,
      triggeredAt: Date.now() - 60_000,
      reason: "stale",
    });

    fakes.rateTracker.listActiveTenants.mockResolvedValue(["proj_acme"]);
    fakes.rateTracker.perMinuteSeries.mockResolvedValue(
      Array.from({ length: 100 }, () => 10),
    );
    // Rate is back to normal
    fakes.rateTracker.currentWindowCount.mockResolvedValue(50);

    const detector = new AnomalyDetector(fakes);
    const result = await detector.tick();

    expect(result.cleared).toBe(1);
    expect(fakes.anomalyState.clear).toHaveBeenCalledWith(
      "proj_acme",
      "rate_breaker",
    );
  });

  it("preserves triggeredAt across ticks (anomaly stays the same instance)", async () => {
    const fakes = makeFakes();
    const triggeredAt = Date.now() - 3 * 60_000;
    fakes.stored.set("rate_breaker:proj_acme", {
      tenantId: "proj_acme",
      kind: "rate_breaker",
      tier: "surface",
      currentRate: 100,
      baseline: 10,
      triggeredAt,
      reason: "first tick",
    });

    fakes.rateTracker.listActiveTenants.mockResolvedValue(["proj_acme"]);
    fakes.rateTracker.perMinuteSeries.mockResolvedValue(
      Array.from({ length: 100 }, () => 10),
    );
    fakes.rateTracker.currentWindowCount.mockResolvedValue(500); // still 10×

    const detector = new AnomalyDetector(fakes);
    await detector.tick();

    const arg = fakes.anomalyState.upsert.mock.calls[0]![0] as Anomaly;
    expect(arg.triggeredAt).toBe(triggeredAt);
  });

  // Sanity-check threshold constants haven't drifted from the post-mortem spec.
  it("threshold constants match the spec", () => {
    expect(SURFACE_TIER_MULTIPLIER).toBe(10);
    expect(HARD_TIER_MULTIPLIER).toBe(100);
    expect(SURFACE_TIER_SUSTAIN_MINUTES).toBe(5);
    expect(HARD_TIER_SUSTAIN_MINUTES).toBe(15);
    expect(MIN_BASELINE_RATE).toBe(5);
  });
});
