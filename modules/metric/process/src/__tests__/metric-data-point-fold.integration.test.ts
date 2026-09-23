import { randomUUID } from "node:crypto";

/**
 * @vitest-environment node
 * @integration
 * Tests real ClickHouse INSERT/SELECT with rollup fold, dedup via FINAL, and
 * multi-series handling; verifies data point landing and affected-bucket computation.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import {
  METRIC_ROLLUP_INTERVAL_MS,
  type CanonicalMetricDataPoint,
} from "@langwatch/metric-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { point } from "../app/__tests__/metric.fixture.ts";
import type { MetricClickHouseClient } from "../repositories/clickhouse/clickhouse.metric-data-point-append.repository.ts";
import { MetricDataPointClickHouseRepository } from "../repositories/clickhouse/clickhouse.metric-data-point.repository.ts";
import {
  deleteMigratedTenantRows,
  startMigratedClickHouse,
} from "./migrated-clickhouse.harness.ts";

let ch: ClickHouseClient;
let repo: MetricDataPointClickHouseRepository;

/**
 * The narrow port the repository takes, over the real client. The port carries
 * the tenant-scope escape hatch the driver knows nothing about, so the two
 * shapes are related by this delegation rather than by a cast.
 */
function metricClient(client: ClickHouseClient): MetricClickHouseClient {
  return {
    insert: async (params) => client.insert(params),
    query: async ({ unscoped: _unscoped, ...params }) => {
      const resultSet = await client.query(params);
      return {
        json: async <T>(): Promise<T[]> => {
          // Every statement this port issues asks for JSONEachRow, which parses
          // to rows. The driver's return type also admits the single-object
          // formats, so anything else here is a caller bug worth failing on.
          const parsed = await resultSet.json<T>();
          if (!Array.isArray(parsed)) throw new Error("Expected a JSONEachRow row array");
          return parsed;
        },
      };
    },
  };
}

const tag = randomUUID();
const tenantId = `${tag}-project`;
const organizationId = `${tag}-org`;
const acceptedAt = Date.now();

const gaugeSeriesId = "b".repeat(64);
const cumulativeSeriesId = "c".repeat(64);

// Recent, bucket-aligned base so retention TTLs never GC the rows and the
// bucket boundaries are exact multiples of the 30s rollup interval.
const bucket0 =
  Math.floor((Date.now() - 5 * 60_000) / METRIC_ROLLUP_INTERVAL_MS) * METRIC_ROLLUP_INTERVAL_MS;
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
  ch = (await startMigratedClickHouse()).client;
  const port = metricClient(ch);
  repo = MetricDataPointClickHouseRepository.create({
    resolveClient: async () => port,
    resolveOrganizationClient: async () => port,
    defaultRetentionDays: 30,
  });
}, 180_000);

afterAll(async () => {
  if (!ch) return;
  await deleteMigratedTenantRows({
    client: ch,
    tenantId,
    tables: ["metric_data_points", "metric_usage_estimates", "metric_time_rollups"],
  });
});

describe("given gauge points ensured for a series", () => {
  beforeAll(async () => {
    await repo.ensureDataPoints({
      points: [
        gaugePoint({ timeUnixMs: bucket0 + 1_000, value: 4 }),
        gaugePoint({ timeUnixMs: bucket0 + 2_000, value: 7 }),
      ],
    });
  }, 300_000);

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
    }, 300_000);

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
    }, 300_000);

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
  }, 300_000);

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
    }, 300_000);

    it("folds the chunk to exactly the rollups the per-point path produces", async () => {
      const chunked = await readRollups(chunkSeriesId);
      const perPoint = await readRollups(perPointSeriesId);

      expect(chunked).toEqual(perPoint);
      expect(chunked).toHaveLength(4);
    });

    it("counts every sample exactly once across the buckets", async () => {
      const chunked = await readRollups(chunkSeriesId);

      expect(chunked.reduce((total, row) => total + row.sourcePointCount, 0)).toBe(values.length);
    });
  });

  describe("when the chunk is folded through a client that counts its reads", () => {
    const countedSeriesId = "f".repeat(64);
    let reads: number;

    beforeAll(async () => {
      reads = 0;
      const delegate = metricClient(ch);
      const counting: MetricClickHouseClient = {
        query: async (args) => {
          reads += 1;
          return delegate.query(args);
        },
        insert: async (args) => delegate.insert(args),
      };

      await MetricDataPointClickHouseRepository.create({
        resolveClient: async () => counting,
        resolveOrganizationClient: async () => counting,
        defaultRetentionDays: 30,
      }).recomputeAffectedRollupsMany({ points: samples(countedSeriesId) });
    }, 300_000);

    it("keeps its read count flat however many points the chunk holds", async () => {
      // Seek budget: one for successor seeks, one for affected buckets, one for
      // predecessor pass. Read count stays at 3 regardless of chunk size.
      expect(reads).toBe(3);
    });

    it("still produces the same rollups as the uncounted chunk", async () => {
      const counted = await readRollups(countedSeriesId);

      expect(counted).toHaveLength(4);
      expect(counted).toEqual(await readRollups(chunkSeriesId));
    });
  });
});

/**
 * Tests folded successor read against real ClickHouse: reads within series span plus
 * past-end in another branch. Verifies results match per-point seek when series has
 * stored points between chunk points.
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
    await repo.recomputeAffectedRollupsMany({
      points: preStored.map((index) => sample({ seriesId: foldedSeriesId, index })),
    });
    await repo.recomputeAffectedRollupsMany({
      points: folded.map((index) => sample({ seriesId: foldedSeriesId, index })),
    });
    // The reference series never touches the folded entry point, for either
    // half — seeding its pre-stored half with a chunk would let a folded-read
    // defect cancel out of the comparison. Reverse order is deliberate: every
    // sample is late relative to the one before it, the pattern a chunk collapses.
    for (const index of [...preStored].reverse()) {
      await repo.recomputeAffectedRollups({
        point: sample({ seriesId: perPointSeriesId, index }),
      });
    }
    for (const index of [...folded].reverse()) {
      await repo.recomputeAffectedRollups({
        point: sample({ seriesId: perPointSeriesId, index }),
      });
    }
  }, 300_000);

  /** @scenario "A batch folds to the summaries a point-at-a-time rebuild produces" */
  it("folds to exactly the rollups a point-at-a-time path produces", async () => {
    const chunked = await readRollups(foldedSeriesId);

    expect(chunked).toEqual(await readRollups(perPointSeriesId));
    expect(chunked).toHaveLength(3);
  });

  /** @scenario "A batch folds to the summaries a point-at-a-time rebuild produces" */
  it("counts every sample exactly once across the buckets", async () => {
    const chunked = await readRollups(foldedSeriesId);

    expect(chunked.reduce((total, row) => total + row.sourcePointCount, 0)).toBe(values.length);
  });
});

/**
 * Tests folding chunk with multiple staggered series (the shape {@link bulkAppend}
 * sends). Catches defects in series-to-bounds pairing that would drop successors.
 * Staggered timing ensures bounds differences are observable.
 */
describe("given one chunk carrying two series staggered in time", () => {
  const earlySeriesId = "2".repeat(64);
  const lateSeriesId = "3".repeat(64);
  const earlyReferenceId = "4".repeat(64);
  const lateReferenceId = "5".repeat(64);
  // A counter reset in each series, so every sample's dependency on its
  // predecessor is live rather than incidental.
  const values = [10, 15, 18, 26, 4, 9, 14, 22];
  // The late series starts a full bucket after the early one ends, so neither
  // series' span can stand in for the other's.
  const offsets = {
    early: 0,
    late: values.length * 5_000 + METRIC_ROLLUP_INTERVAL_MS,
  };

  function sample({
    seriesId,
    index,
    offsetMs,
  }: {
    seriesId: string;
    index: number;
    offsetMs: number;
  }): CanonicalMetricDataPoint {
    return point({
      tenantId,
      organizationId,
      seriesId,
      timeUnixMs: bucket0 + offsetMs + index * 5_000,
      metricKind: "sum",
      aggregationTemporality: "cumulative",
      isMonotonic: true,
      valueDouble: values[index]!,
      acceptedAt,
    });
  }

  const indices = values.map((_, index) => index);
  const preStored = indices.filter((index) => index % 2 === 1);
  const arriving = indices.filter((index) => index % 2 === 0);

  beforeAll(async () => {
    // Each series already holds points between the chunk's own points, so the
    // within-span branch has interior successors to supply, and the chunk's
    // newest point in each series needs the look past its own span end.
    await repo.recomputeAffectedRollupsMany({
      points: [
        ...preStored.map((index) =>
          sample({ seriesId: earlySeriesId, index, offsetMs: offsets.early }),
        ),
        ...preStored.map((index) =>
          sample({ seriesId: lateSeriesId, index, offsetMs: offsets.late }),
        ),
      ],
    });
    // The one chunk under test: both series, in one call, exactly as
    // bulkAppend coalesces them.
    await repo.recomputeAffectedRollupsMany({
      points: [
        ...arriving.map((index) =>
          sample({ seriesId: earlySeriesId, index, offsetMs: offsets.early }),
        ),
        ...arriving.map((index) =>
          sample({ seriesId: lateSeriesId, index, offsetMs: offsets.late }),
        ),
      ],
    });
    // References rebuilt one point at a time, never through the folded entry
    // point, in the same late-arrival order.
    for (const [referenceId, offsetMs] of [
      [earlyReferenceId, offsets.early],
      [lateReferenceId, offsets.late],
    ] as const) {
      for (const index of [...preStored, ...arriving].reverse()) {
        await repo.recomputeAffectedRollups({
          point: sample({ seriesId: referenceId, index, offsetMs }),
        });
      }
    }
  }, 600_000);

  /** @scenario "A batch carrying several series folds each of them correctly" */
  it("folds the early series to the rollups its point-at-a-time rebuild produces", async () => {
    const folded = await readRollups(earlySeriesId);

    expect(folded).toEqual(await readRollups(earlyReferenceId));
    expect(folded.length).toBeGreaterThan(1);
  });

  /** @scenario "A batch carrying several series folds each of them correctly" */
  it("folds the late series to the rollups its point-at-a-time rebuild produces", async () => {
    const folded = await readRollups(lateSeriesId);

    expect(folded).toEqual(await readRollups(lateReferenceId));
    expect(folded.length).toBeGreaterThan(1);
  });

  /** @scenario "A batch carrying several series folds each of them correctly" */
  it("counts every sample of both series exactly once", async () => {
    for (const seriesId of [earlySeriesId, lateSeriesId]) {
      const folded = await readRollups(seriesId);

      expect(folded.reduce((total, row) => total + row.sourcePointCount, 0)).toBe(values.length);
    }
  });
});
