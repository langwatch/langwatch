/**
 * @vitest-environment node
 * @integration
 *
 * Runs the canonical metric repository's real INSERT/SELECT SQL against
 * ClickHouse (migration 00049). The rollup unit tests exercise the pure fold;
 * the immediateNeighbors / pointsForBuckets queries and the rollup INSERT they
 * feed are only ever mocked. This file is what proves:
 * - ensureDataPoints lands raw points plus their usage-estimate ledger rows;
 * - recomputeAffectedRollupsMany converts a cumulative monotonic sum series
 *   spanning two 30s buckets into per-bucket deltas using rows it fetched back
 *   from ClickHouse, not the in-memory chunk;
 * - a late point ensured between existing samples converges the affected
 *   buckets on re-recompute (ReplacingMergeTree(UpdatedAt), read via FINAL —
 *   the dedup pattern migration 00049 mandates for metric_time_rollups).
 *
 * Fixtures come from the shared metric-point builder the rollup unit tests
 * use, so expectations here mirror rollupScalar.unit.test.ts semantics: the
 * first cumulative sample of a sequence contributes its full value
 * (reset-start), later samples contribute value deltas.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { point } from "~/server/event-sourcing/pipelines/metric-processing/__tests__/fixtures/metric-point.fixtures";
import { METRIC_ROLLUP_INTERVAL_MS } from "~/server/event-sourcing/pipelines/metric-processing/schemas/constants";
import type { CanonicalMetricDataPoint } from "~/server/event-sourcing/pipelines/metric-processing/schemas/metricDataPoint";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { MetricDataPointClickHouseRepository } from "../metric-data-point.clickhouse.repository";

let ch: ClickHouseClient;
let repo: MetricDataPointClickHouseRepository;

const tag = nanoid();
const tenantId = `${tag}-project`;
const organizationId = `${tag}-org`;
const acceptedAt = Date.now();

const gaugeSeriesId = "b".repeat(64);
const cumulativeSeriesId = "c".repeat(64);

// Recent, bucket-aligned base so retention TTLs never GC the rows and the
// bucket boundaries are exact multiples of the 30s rollup interval.
const bucket0 =
  Math.floor((Date.now() - 5 * 60_000) / METRIC_ROLLUP_INTERVAL_MS) *
  METRIC_ROLLUP_INTERVAL_MS;
const bucket1 = bucket0 + METRIC_ROLLUP_INTERVAL_MS;

function gaugePoint({
  timeUnixMs,
  value,
}: {
  timeUnixMs: number;
  value: number;
}): CanonicalMetricDataPoint {
  return point({
    tenantId,
    organizationId,
    seriesId: gaugeSeriesId,
    timeUnixMs,
    valueDouble: value,
    acceptedAt,
  });
}

function cumulativePoint({
  timeUnixMs,
  value,
}: {
  timeUnixMs: number;
  value: number;
}): CanonicalMetricDataPoint {
  return point({
    tenantId,
    organizationId,
    seriesId: cumulativeSeriesId,
    timeUnixMs,
    metricKind: "sum",
    aggregationTemporality: "cumulative",
    isMonotonic: true,
    valueDouble: value,
    acceptedAt,
  });
}

interface RollupReadRow {
  BucketStartMs: number | string;
  Sum: number | null;
  Count: number | string;
  ResetCount: number;
  SourcePointCount: number;
}

/** The authoritative-read pattern 00049 mandates: FINAL over the RMT. */
async function readRollups(seriesId: string) {
  const result = await ch.query({
    query: `
      SELECT
        toUnixTimestamp64Milli(BucketStart) AS BucketStartMs,
        Sum,
        Count,
        ResetCount,
        SourcePointCount
      FROM metric_time_rollups FINAL
      WHERE TenantId = {tenantId:String}
        AND SeriesId = {seriesId:String}
      ORDER BY BucketStart ASC
    `,
    query_params: { tenantId, seriesId },
    format: "JSONEachRow",
  });
  const rows = await result.json<RollupReadRow>();
  return rows.map((row) => ({
    bucketStartMs: Number(row.BucketStartMs),
    sum: row.Sum,
    count: Number(row.Count),
    resetCount: row.ResetCount,
    sourcePointCount: row.SourcePointCount,
  }));
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  repo = new MetricDataPointClickHouseRepository({
    resolveClient: async () => ch,
    resolveOrganizationClient: async () => ch,
  });
}, 60_000);

afterAll(async () => {
  if (ch) {
    for (const table of [
      "metric_data_points",
      "metric_usage_estimates",
      "metric_time_rollups",
    ]) {
      await ch.exec({
        query: `ALTER TABLE ${table} DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId },
      });
    }
  }
  await stopTestContainers();
});

describe("given gauge points ensured for a series", () => {
  beforeAll(async () => {
    await repo.ensureDataPoints({
      points: [
        gaugePoint({ timeUnixMs: bucket0 + 1_000, value: 4 }),
        gaugePoint({ timeUnixMs: bucket0 + 2_000, value: 7 }),
      ],
    });
  }, 30_000);

  describe("when reading the raw data-points table back", () => {
    it("finds every inserted point for the tenant", async () => {
      const result = await ch.query({
        query: `
          SELECT uniqExact(PointId) AS c
          FROM metric_data_points
          WHERE TenantId = {tenantId:String}
            AND SeriesId = {seriesId:String}
        `,
        query_params: { tenantId, seriesId: gaugeSeriesId },
        format: "JSONEachRow",
      });
      const rows = await result.json<{ c: number | string }>();

      expect(Number(rows[0]!.c)).toBe(2);
    });

    it("writes a usage-estimate ledger row per point", async () => {
      const result = await ch.query({
        query: `
          SELECT uniqExact(PointId) AS c
          FROM metric_usage_estimates
          WHERE TenantId = {tenantId:String}
            AND SeriesId = {seriesId:String}
        `,
        query_params: { tenantId, seriesId: gaugeSeriesId },
        format: "JSONEachRow",
      });
      const rows = await result.json<{ c: number | string }>();

      expect(Number(rows[0]!.c)).toBe(2);
    });
  });
});

describe("given a cumulative monotonic sum series spanning two rollup buckets", () => {
  // Mirrors rollupScalar.unit.test.ts "when a cumulative sum arrives late":
  // 10, 15 in bucket0 and 18 in bucket1 fold to bucket sums 15 (10 as
  // reset-start + delta 5) and 3 (18 - 15).
  const first = cumulativePoint({ timeUnixMs: bucket0 + 5_000, value: 10 });
  const second = cumulativePoint({ timeUnixMs: bucket0 + 15_000, value: 15 });
  const third = cumulativePoint({ timeUnixMs: bucket1 + 5_000, value: 18 });

  describe("when the rollups are recomputed from real ClickHouse reads", () => {
    beforeAll(async () => {
      // Mirrors MetricTimeRollupAppendStore.bulkAppend's invocation shape.
      await repo.recomputeAffectedRollupsMany({
        points: [first, second, third],
      });
    }, 30_000);

    it("converts the cumulative series to per-bucket deltas", async () => {
      const rollups = await readRollups(cumulativeSeriesId);

      expect(rollups).toEqual([
        {
          bucketStartMs: bucket0,
          sum: 15,
          count: 2,
          resetCount: 0,
          sourcePointCount: 2,
        },
        {
          bucketStartMs: bucket1,
          sum: 3,
          count: 1,
          resetCount: 0,
          sourcePointCount: 1,
        },
      ]);
    });
  });

  describe("when a late point arrives between existing samples", () => {
    beforeAll(async () => {
      // 16 lands between 15 and 18 inside bucket0; both its own bucket and
      // the next sample's bucket must be revised (18 now differences 16).
      await repo.recomputeAffectedRollupsMany({
        points: [cumulativePoint({ timeUnixMs: bucket0 + 20_000, value: 16 })],
      });
    }, 30_000);

    it("converges both affected buckets to the recomputed deltas", async () => {
      const rollups = await readRollups(cumulativeSeriesId);

      expect(rollups).toEqual([
        {
          bucketStartMs: bucket0,
          sum: 16,
          count: 3,
          resetCount: 0,
          sourcePointCount: 3,
        },
        {
          bucketStartMs: bucket1,
          sum: 2,
          count: 1,
          resetCount: 0,
          sourcePointCount: 1,
        },
      ]);
    });
  });
});
