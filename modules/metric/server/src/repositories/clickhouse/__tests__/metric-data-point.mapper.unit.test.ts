/**
 * Tests dedup version logic: first acceptance wins (product rule), so timestamp is
 * inverted—earlier acceptance produces larger version. ReplacingMergeTree keeps largest,
 * so inversion ensures first write survives retry.
 */

import type { CanonicalMetricDataPoint } from "@langwatch/metric-contract";
import { describe, expect, it } from "vitest";
import { point } from "../../../app/__tests__/metric.fixture.ts";
import { MetricDataPointMapper } from "../clickhouse.metric-data-point.mapper.ts";

const EARLIER = 1_787_000_000_000;
const LATER = EARLIER + 60_000;

const versionAt = (acceptedAt: number) =>
  BigInt(MetricDataPointMapper.firstAcceptanceWinsVersion(acceptedAt));

const accepted = (acceptedAt: number): CanonicalMetricDataPoint =>
  ({ ...point({ timeUnixMs: EARLIER }), acceptedAt }) as CanonicalMetricDataPoint;

describe("MetricDataPointMapper.firstAcceptanceWinsVersion", () => {
  describe("given the same point accepted twice", () => {
    /** @scenario "Canonical metric identity and retries are stable" */
    it("gives the earlier acceptance the LARGER version, so the merge keeps it", () => {
      expect(versionAt(EARLIER)).toBeGreaterThan(versionAt(LATER));
    });

    it("gives one acceptance one version, so a retry at the same instant is a no-op", () => {
      expect(versionAt(EARLIER)).toEqual(versionAt(EARLIER));
    });
  });

  describe("the value it writes", () => {
    it("stays a non-negative integer string, which is what UInt64 accepts", () => {
      const version = MetricDataPointMapper.firstAcceptanceWinsVersion(EARLIER);

      expect(version).toMatch(/^\d+$/);
      expect(BigInt(version)).toBeGreaterThan(0n);
    });
  });

  describe("the rows that carry it", () => {
    it("stamps the raw row", () => {
      const row = MetricDataPointMapper.rawRow({
        point: accepted(EARLIER),
        retentionDays: 30,
      }) as { DedupVersion: string };

      expect(row.DedupVersion).toBe(MetricDataPointMapper.firstAcceptanceWinsVersion(EARLIER));
    });

    it("stamps the usage-estimate row with the same rule, so the two cannot disagree", () => {
      // These are the only two rows carrying a dedup version, and they have to
      // agree: the estimate is derived from the same acceptance as the point,
      // so a retry that replaced one and not the other would leave a usage
      // figure describing a measurement that is no longer stored.
      const raw = MetricDataPointMapper.rawRow({
        point: accepted(EARLIER),
        retentionDays: 30,
      }) as { DedupVersion: string };
      const estimate = MetricDataPointMapper.usageEstimateRow(accepted(EARLIER)) as {
        DedupVersion: string;
      };

      expect(estimate.DedupVersion).toBe(raw.DedupVersion);
    });
  });
});
