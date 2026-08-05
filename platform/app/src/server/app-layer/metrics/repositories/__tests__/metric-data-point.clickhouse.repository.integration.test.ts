/**
 * @vitest-environment node
 * @integration
 *
 * Runs the canonical metric repository's real INSERT/SELECT SQL against
 * ClickHouse (migration 00049). The rollup unit tests exercise the pure fold;
 * the successor / affected-bucket seek queries and the rollup INSERT they feed
 * are only ever mocked. This file is what proves:
 * - ensureDataPoints lands raw points plus their usage-estimate ledger rows;
 * - recomputeAffectedRollupsMany converts a cumulative monotonic sum series
 *   spanning two 30s buckets into per-bucket deltas using rows it fetched back
 *   from ClickHouse, not the in-memory chunk;
 * - a late point ensured between existing samples converges the affected
 *   buckets on re-recompute (ReplacingMergeTree(UpdatedAt), read via FINAL —
 *   the dedup pattern migration 00049 mandates for metric_time_rollups);
 * - folding a chunk in one pass lands on exactly the rollups the per-point
 *   path produces, using a number of reads set by the affected buckets rather
 *   than by how many points the chunk carries.
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

describe("given a cumulative series long enough to span several rollup buckets", () => {
  // Twelve samples every ten seconds cover four 30s buckets, and the drop to 4
  // is a counter reset, so the fold's dependency on each sample's predecessor
  // is live rather than incidental.
  const values = [10, 15, 18, 26, 31, 4, 9, 14, 22, 27, 33, 40];
  // Shared, because the read-counting block below compares its own rollups
  // against this series rather than writing a second copy of them. Seeded in
  // THIS describe's beforeAll so a filtered run of either child block still
  // finds the rollups it compares against.
  const chunkSeriesId = "d".repeat(64);

  function samples(seriesId: string): CanonicalMetricDataPoint[] {
    return values.map((value, index) =>
      point({
        tenantId,
        organizationId,
        seriesId,
        timeUnixMs: bucket0 + index * 10_000,
        metricKind: "sum",
        aggregationTemporality: "cumulative",
        isMonotonic: true,
        valueDouble: value,
        acceptedAt,
      }),
    );
  }

  beforeAll(async () => {
    await repo.recomputeAffectedRollupsMany({
      points: samples(chunkSeriesId),
    });
  }, 60_000);

  describe("when one series folds as a chunk and an identical one folds a point at a time", () => {
    // Both series use the same timestamps, so the fixture derives the same
    // point ids for both. That is deliberate: a point id is only unique within
    // its series, and the chunk path reads many series in one query.
    const perPointSeriesId = "e".repeat(64);

    beforeAll(async () => {
      // Reverse order on purpose: every sample is late relative to the one
      // before it, which is the arrival pattern a chunk collapses.
      for (const single of [...samples(perPointSeriesId)].reverse()) {
        await repo.recomputeAffectedRollups({ point: single });
      }
    }, 60_000);

    it("folds the chunk to exactly the rollups the per-point path produces", async () => {
      const chunked = await readRollups(chunkSeriesId);
      const perPoint = await readRollups(perPointSeriesId);

      expect(chunked).toEqual(perPoint);
      expect(chunked).toHaveLength(4);
    });

    it("counts every sample exactly once across the buckets", async () => {
      const chunked = await readRollups(chunkSeriesId);

      expect(
        chunked.reduce((total, row) => total + row.sourcePointCount, 0),
      ).toBe(values.length);
    });
  });

  describe("when the chunk is folded through a client that counts its reads", () => {
    const countedSeriesId = "f".repeat(64);
    let reads: number;

    beforeAll(async () => {
      reads = 0;
      const counting = {
        query: async (args: Parameters<ClickHouseClient["query"]>[0]) => {
          reads += 1;
          return await ch.query(args);
        },
        insert: async (args: Parameters<ClickHouseClient["insert"]>[0]) =>
          await ch.insert(args),
      } as unknown as ClickHouseClient;

      await new MetricDataPointClickHouseRepository({
        resolveClient: async () => counting,
        resolveOrganizationClient: async () => counting,
      }).recomputeAffectedRollupsMany({ points: samples(countedSeriesId) });
    }, 60_000);

    it("reads once for the successors and once for the affected buckets", async () => {
      // The seek budget folds all twelve successor seeks into one statement
      // and every affected bucket into a second. Reading per point would make
      // this grow with the chunk instead.
      expect(reads).toBe(2);
    });

    it("still produces the same rollups as the uncounted chunk", async () => {
      const counted = await readRollups(countedSeriesId);

      expect(counted).toHaveLength(4);
      expect(counted).toEqual(await readRollups(chunkSeriesId));
    });
  });
});

/**
 * The folded successor read does not seek once per point: within a series it
 * reads the chunk's own span in one branch and looks past the end of it in
 * another. Its results are only identical to a seek per point because every
 * chunk point is already stored, so no chunk point's successor can be further
 * away than the next chunk point. That argument is what this block exercises
 * against real ClickHouse - a series where the rows between the chunk's points
 * are rows the chunk itself does not carry.
 */
describe("given a series whose chunk points have stored points between them", () => {
  const foldedSeriesId = "0".repeat(64);
  const perPointSeriesId = "1".repeat(64);
  // Sixteen cumulative samples every five seconds cover three 30s buckets, and
  // the drop to 4 is a counter reset, so every sample's dependency on its
  // predecessor is live rather than incidental.
  const values = [10, 15, 18, 26, 31, 4, 9, 14, 22, 27, 33, 40, 44, 51, 55, 60];
  const preStored = values.map((_, index) => index).filter((i) => i % 2 === 1);
  const folded = values.map((_, index) => index).filter((i) => i % 2 === 0);

  function sample({
    seriesId,
    index,
  }: {
    seriesId: string;
    index: number;
  }): CanonicalMetricDataPoint {
    return point({
      tenantId,
      organizationId,
      seriesId,
      timeUnixMs: bucket0 + index * 5_000,
      metricKind: "sum",
      aggregationTemporality: "cumulative",
      isMonotonic: true,
      valueDouble: values[index]!,
      acceptedAt,
    });
  }

  beforeAll(async () => {
    // Both series start from the same stored half, so the only difference is
    // how the other half arrives.
    for (const seriesId of [foldedSeriesId, perPointSeriesId]) {
      await repo.recomputeAffectedRollupsMany({
        points: preStored.map((index) => sample({ seriesId, index })),
      });
    }
    await repo.recomputeAffectedRollupsMany({
      points: folded.map((index) =>
        sample({ seriesId: foldedSeriesId, index }),
      ),
    });
    // Reverse order on purpose: every sample is late relative to the one
    // before it, which is the arrival pattern a chunk collapses.
    for (const index of [...folded].reverse()) {
      await repo.recomputeAffectedRollups({
        point: sample({ seriesId: perPointSeriesId, index }),
      });
    }
  }, 60_000);

  /** @scenario "A batch folds to the summaries a point-at-a-time rebuild produces" */
  it("folds to exactly the rollups a point-at-a-time path produces", async () => {
    const chunked = await readRollups(foldedSeriesId);

    expect(chunked).toEqual(await readRollups(perPointSeriesId));
    expect(chunked).toHaveLength(3);
  });

  /** @scenario "A batch folds to the summaries a point-at-a-time rebuild produces" */
  it("counts every sample exactly once across the buckets", async () => {
    const chunked = await readRollups(foldedSeriesId);

    expect(
      chunked.reduce((total, row) => total + row.sourcePointCount, 0),
    ).toBe(values.length);
  });
});
