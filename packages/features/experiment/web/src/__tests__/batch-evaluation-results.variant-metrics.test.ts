import { describe, expect, it } from "vitest";
import { computeVariantMetrics } from "@langwatch/experiment-web";
import type { BatchResultRow, BatchTargetOutput } from "@langwatch/experiment-web";

const target = (overrides: Partial<BatchTargetOutput> = {}): BatchTargetOutput => ({
  targetId: "variant-a",
  output: { output: "hi" },
  cost: null,
  duration: null,
  error: null,
  traceId: null,
  evaluatorResults: [],
  ...overrides,
});

const row = (targets: Record<string, BatchTargetOutput>, index = 0): BatchResultRow => ({
  index,
  datasetEntry: {},
  targets,
});

describe("computeVariantMetrics", () => {
  it("averages cost and duration across rows a variant appears in", () => {
    const rows: BatchResultRow[] = [
      row({ "variant-a": target({ cost: 0.01, duration: 100 }) }, 0),
      row({ "variant-a": target({ cost: 0.03, duration: 300 }) }, 1),
    ];

    const metrics = computeVariantMetrics({
      variantIds: ["variant-a"],
      rows: rows,
    });

    expect(metrics["variant-a"]!.costStats?.avg).toBeCloseTo(0.02);
    expect(metrics["variant-a"]!.durationStats?.avg).toBeCloseTo(200);
    expect(metrics["variant-a"]!.costStats?.count).toBe(2);
  });

  it("skips rows where the variant is missing entirely", () => {
    const rows: BatchResultRow[] = [
      row({ "variant-a": target({ cost: 0.01 }) }, 0),
      row({ "variant-b": target({ targetId: "variant-b", cost: 0.05 }) }, 1),
    ];

    const metrics = computeVariantMetrics({
      variantIds: ["variant-a"],
      rows: rows,
    });

    expect(metrics["variant-a"]!.costStats?.count).toBe(1);
    expect(metrics["variant-a"]!.costStats?.avg).toBeCloseTo(0.01);
  });

  it("skips rows where cost or duration is null", () => {
    const rows: BatchResultRow[] = [
      row({ "variant-a": target({ cost: null, duration: 100 }) }, 0),
      row({ "variant-a": target({ cost: 0.02, duration: null }) }, 1),
    ];

    const metrics = computeVariantMetrics({
      variantIds: ["variant-a"],
      rows: rows,
    });

    expect(metrics["variant-a"]!.costStats?.count).toBe(1);
    expect(metrics["variant-a"]!.costStats?.avg).toBeCloseTo(0.02);
    expect(metrics["variant-a"]!.durationStats?.count).toBe(1);
    expect(metrics["variant-a"]!.durationStats?.avg).toBeCloseTo(100);
  });

  it("returns null stats for a variant with no cost/duration data at all", () => {
    const rows: BatchResultRow[] = [
      row({ "variant-a": target({ cost: null, duration: null }) }, 0),
    ];

    const metrics = computeVariantMetrics({
      variantIds: ["variant-a"],
      rows: rows,
    });

    expect(metrics["variant-a"]!.costStats).toBeNull();
    expect(metrics["variant-a"]!.durationStats).toBeNull();
  });

  it("returns an entry for every requested variant id, even with zero rows", () => {
    const metrics = computeVariantMetrics({
      variantIds: ["variant-a", "variant-b"],
      rows: [],
    });

    expect(Object.keys(metrics)).toEqual(["variant-a", "variant-b"]);
    expect(metrics["variant-b"]!.costStats).toBeNull();
  });
});
