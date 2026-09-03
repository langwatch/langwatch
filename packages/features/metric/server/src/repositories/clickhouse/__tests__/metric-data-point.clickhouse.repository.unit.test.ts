import { formatQueryParams } from "@clickhouse/client/dist/common";
import type { CanonicalMetricDataPoint } from "@langwatch/metric-contract";
import { describe, expect, it, vi, type Mock } from "vitest";
import { MetricDataPointClickHouseRepository } from "../clickhouse.metric-data-point.repository";
import type { MetricClickHouseClient } from "../clickhouse.metric-data-point-append.repository";
import { MetricDataPointMapper } from "../clickhouse.metric-data-point.mapper";
import { METRIC_ROLLUP_INTERVAL_MS } from "@langwatch/metric-contract";
import { point } from "@langwatch/metric-server/testing";

type InsertCall = { table: string; values: readonly unknown[] };

function response(rows: unknown[]): { json<T = unknown>(): Promise<T[]> } {
  return {
    json: async <T>() => rows.filter((_row): _row is T => true),
  };
}

function client({
  insert = vi.fn<MetricClickHouseClient["insert"]>(async () => undefined),
  rows = [],
  onQuery,
  query: queryOverride,
}: {
  insert?: MetricClickHouseClient["insert"];
  rows?: unknown[];
  onQuery?: (query: string) => unknown[];
  query?: MetricClickHouseClient["query"];
} = {}): MetricClickHouseClient {
  if (queryOverride) return { insert, query: queryOverride };
  const query: MetricClickHouseClient["query"] = async ({ query: sql }) =>
    response(onQuery?.(sql) ?? rows);
  return { insert, query };
}

function repository(
  project: MetricClickHouseClient,
  organization = project,
): MetricDataPointClickHouseRepository {
  return MetricDataPointClickHouseRepository.create({
    resolveClient: async () => project,
    resolveOrganizationClient: async () => organization,
    defaultRetentionDays: 30,
  });
}

function insertCalls(insert: Mock<MetricClickHouseClient["insert"]>): InsertCall[] {
  return insert.mock.calls.map(([call]) => call);
}

function encodedParamLength(params: Record<string, unknown>): number {
  return new URLSearchParams(
    Object.entries(params).map(([name, value]): [string, string] => [
      `param_${name}`,
      formatQueryParams({ value }),
    ]),
  ).toString().length;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

const base = Math.floor(1_700_000_000_000 / METRIC_ROLLUP_INTERVAL_MS) * METRIC_ROLLUP_INTERVAL_MS;

function pointAt(overrides: Partial<CanonicalMetricDataPoint> = {}): CanonicalMetricDataPoint {
  const timeUnixMs = overrides.timeUnixMs ?? base + 1_000;
  return point({
    timeUnixMs,
    pointId: overrides.pointId ?? "a".repeat(64),
    seriesId: overrides.seriesId ?? "b".repeat(64),
    ...overrides,
  });
}

function isSuccessorRead(sql: string): boolean {
  return sql.includes("{seriesIds:Array(String)}");
}

/** A stored row as {@link ROLLUP_SELECT} returns it. */
function rollupSourceRow(from: CanonicalMetricDataPoint): Record<string, unknown> {
  return {
    TenantId: from.tenantId,
    PointId: from.pointId,
    SeriesId: from.seriesId,
    MetricName: from.metricName,
    MetricUnit: from.metricUnit,
    MetricKind: from.metricKind,
    AggregationTemporality: from.aggregationTemporality,
    IsMonotonic: from.isMonotonic,
    StartTimeUnixNano: from.startTimeUnixNano,
    TimeUnixNano: from.timeUnixNano,
    TimeUnixMs: from.timeUnixMs,
    ValueType: from.valueType,
    ValueInt: from.valueInt,
    ValueDouble: from.valueDouble,
    Count: from.count,
    Sum: from.sum,
    Min: from.min,
    Max: from.max,
    ExplicitBounds: from.explicitBounds,
    BucketCounts: from.bucketCounts,
    ExponentialScale: from.exponentialScale,
    ExponentialZeroThreshold: from.exponentialZeroThreshold,
    ZeroCount: from.zeroCount,
    PositiveOffset: from.positiveOffset,
    PositiveBucketCounts: from.positiveBucketCounts,
    NegativeOffset: from.negativeOffset,
    NegativeBucketCounts: from.negativeBucketCounts,
  };
}

/**
 * A reader whose bucket reads answer with the point just before the chunk,
 * which is what a live series looks like: the near predecessor pass finds
 * something, so nothing falls through to the retention-wide one.
 */
function readerWithPredecessor(): {
  queries: string[];
  client: MetricClickHouseClient;
} {
  const predecessor = pointAt({
    timeUnixMs: base - METRIC_ROLLUP_INTERVAL_MS,
    timeUnixNano: String(BigInt(base - METRIC_ROLLUP_INTERVAL_MS) * 1_000_000n),
  });
  const queries: string[] = [];
  const query: MetricClickHouseClient["query"] = async ({ query: sql }) => {
    queries.push(sql);
    return response(isSuccessorRead(sql) ? [] : [rollupSourceRow(predecessor)]);
  };
  return { queries, client: client({ query }) };
}

describe("MetricDataPointClickHouseRepository", () => {
  /** @scenario "Valid OTLP points become canonical durable events" */
  it("writes raw data before its payload-free usage estimate", async () => {
    const insert = vi.fn<MetricClickHouseClient["insert"]>(async () => undefined);
    await repository(client({ insert })).ensureDataPoint({
      point: pointAt({ canonicalSizeBytes: 23 }),
      retentionDays: 49,
    });

    expect(insertCalls(insert).map(({ table }) => table)).toEqual([
      "metric_data_points",
      "metric_usage_estimates",
    ]);
    expect(insertCalls(insert)[0]?.values[0]).toMatchObject({
      TenantId: "project-1",
      OccurredAt: new Date(base + 1_000),
      AcceptedAt: new Date(1_800_000_000_000),
      _retention_days: 49,
    });
    expect(insertCalls(insert)[1]?.values[0]).toMatchObject({
      OrganizationId: "organization-1",
      PointId: "a".repeat(64),
      CanonicalSourceBytes: 23,
    });
    expect(insertCalls(insert)[1]?.values[0]).not.toHaveProperty("CanonicalPayload");
  });

  it("writes one raw and one usage batch for a replay chunk", async () => {
    const insert = vi.fn<MetricClickHouseClient["insert"]>(async () => undefined);
    const points = [1, 2, 3].map((offset) =>
      pointAt({
        pointId: `${offset}`.padStart(64, "0"),
        timeUnixMs: base + offset,
      }),
    );

    await repository(client({ insert })).ensureDataPoints({ points, retentionDays: 49 });

    expect(insert).toHaveBeenCalledTimes(2);
    expect(insertCalls(insert).map(({ values }) => values)).toEqual([
      expect.arrayContaining([expect.any(Object), expect.any(Object), expect.any(Object)]),
      expect.arrayContaining([expect.any(Object), expect.any(Object), expect.any(Object)]),
    ]);
  });

  it("keeps only the newest point when upserting one series", async () => {
    const insert = vi.fn<MetricClickHouseClient["insert"]>(async () => undefined);
    const points = [1_000, 3_000, 2_000].map((timeUnixMs, index) =>
      pointAt({ pointId: `${index}`.padStart(64, "0"), timeUnixMs }),
    );

    await repository(client({ insert })).upsertSeriesMany({ points, retentionDays: 49 });

    expect(insert).toHaveBeenCalledOnce();
    expect(insertCalls(insert)[0]?.values).toHaveLength(1);
    expect(insertCalls(insert)[0]?.values[0]).toMatchObject({ LastSeenAt: new Date(3_000) });
  });

  /** @scenario "The organization-wide usage read still routes by organization" */
  it("routes usage reads through the organization resolver and deduplicates by PointId", async () => {
    const queryCalls: string[] = [];
    const query: MetricClickHouseClient["query"] = async ({ query: sql }) => {
      queryCalls.push(sql);
      return response([
        {
          OrganizationId: "organization-1",
          UniqueActiveSeries: "2",
          ActiveSeriesHours: "3",
          AcceptedPoints: "5",
          CanonicalRetainedBytes: "123",
          ProjectedEventEquivalentUsage: "3",
        },
      ]);
    };
    const project = client({ onQuery: () => [] });
    const organization = client({ query });
    const projectResolver = vi.fn(async () => project);
    const organizationResolver = vi.fn(async () => organization);
    const repositoryInstance = MetricDataPointClickHouseRepository.create({
      resolveClient: projectResolver,
      resolveOrganizationClient: organizationResolver,
      defaultRetentionDays: 30,
    });

    await expect(
      repositoryInstance.queryUsageEstimates({
        organizationId: "organization-1",
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2026-02-01T00:00:00Z"),
        groupBy: "organization",
      }),
    ).resolves.toEqual([
      {
        organizationId: "organization-1",
        tenantId: null,
        metricName: null,
        acceptedHour: null,
        uniqueActiveSeries: 2,
        activeSeriesHours: 3,
        acceptedPoints: 5,
        canonicalRetainedBytes: 123,
        projectedEventEquivalentUsage: 3,
      },
    ]);
    expect(projectResolver).not.toHaveBeenCalled();
    expect(organizationResolver).toHaveBeenCalledWith("organization-1");
    expect(queryCalls[0]).toContain("GROUP BY PointId");
    expect(queryCalls[0]).toContain("OrganizationId = {organizationId:String}");
    expect(queryCalls[0]).not.toContain("TenantId = {tenantId:String}");
  });

  it("keeps rollup reads flat as a coalesced chunk grows", async () => {
    const queries: string[] = [];
    const query: MetricClickHouseClient["query"] = async ({ query: sql }) => {
      queries.push(sql);
      return response([]);
    };
    const repositoryInstance = repository(client({ query }));
    const points = Array.from({ length: 130 }, (_, index) =>
      pointAt({ pointId: `${index}`.padStart(64, "0"), timeUnixMs: base + index }),
    );

    await repositoryInstance.recomputeAffectedRollupsMany({ points });

    // Successors, then the bucket's own rows with a near predecessor seek,
    // then — because this table is empty and so no near seek resolves — the
    // retention-wide seek for the buckets the near one left open.
    expect(queries).toHaveLength(3);
    expect(queries[0]).toContain("LIMIT 1 BY SeriesId");
    expect(queries[0]).toContain("SeekTime > spans.SpanToTime");
    expect(queries[0]).not.toContain("CanonicalPayload");
    expect(queries[1]).toContain("BucketCounts");
    expect(queries[1]).not.toContain("CanonicalPayload");
  });

  it("chunks successor parameters below the URL budget", async () => {
    const queryCalls: Array<{ query: string; query_params?: Record<string, unknown> }> = [];
    const query: MetricClickHouseClient["query"] = async (request) => {
      queryCalls.push(request);
      return response([]);
    };
    const repositoryInstance = repository(client({ query }));
    const points = Array.from({ length: 64 }, (_, index) =>
      pointAt({
        pointId: `${index}`.padStart(64, "0"),
        seriesId: `${index}`.padStart(64, "0"),
        timeUnixMs: base + index,
      }),
    );

    await repositoryInstance.recomputeAffectedRollupsMany({ points });

    expect(encodedParamLength(queryCalls[0]?.query_params ?? {})).toBeLessThan(3_600);
  });

  it.each([1, 12, 64, 130, 260])(
    "keeps the successor statement and parameter count fixed for %i points",
    async (count) => {
      const requests: Array<{ query: string; params: Record<string, unknown> }> = [];
      const query: MetricClickHouseClient["query"] = async (request) => {
        if (request.query.includes("{seriesIds:Array(String)}")) {
          requests.push({ query: request.query, params: request.query_params ?? {} });
        }
        return response([]);
      };
      const points = Array.from({ length: count }, (_, index) =>
        pointAt({ pointId: `${index}`.padStart(64, "0"), timeUnixMs: base + index }),
      );

      await repository(client({ query })).recomputeAffectedRollupsMany({ points });

      expect(requests).not.toHaveLength(0);
      expect(new Set(requests.map((request) => request.query)).size).toBe(1);
      expect(
        new Set(requests.map((request) => Object.keys(request.params).sort().join(","))).size,
      ).toBe(1);
      expect(Object.keys(requests[0]?.params ?? {}).sort()).toEqual([
        "earliestSpanEnd",
        "fromNanos",
        "fromPoints",
        "fromTimes",
        "latestSpanEnd",
        "scanFrom",
        "seriesIds",
        "tenantId",
        "toNanos",
        "toPoints",
        "toTimes",
      ]);
    },
  );

  it("splits successor reads by encoded parameter bytes without dropping series", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const query: MetricClickHouseClient["query"] = async (request) => {
      if (request.query.includes("{seriesIds:Array(String)}")) {
        requests.push(request.query_params ?? {});
      }
      return response([]);
    };
    const points = Array.from({ length: 64 }, (_, index) =>
      pointAt({
        pointId: `${index}`.padStart(64, "0"),
        seriesId: `${index + 1}`.padStart(64, "0"),
        timeUnixMs: base + index * 1_000,
      }),
    );

    await repository(client({ query })).recomputeAffectedRollupsMany({ points });

    expect(requests.length).toBeGreaterThan(1);
    const asked = requests.flatMap((params) => stringArray(params.seriesIds));
    expect(new Set(asked).size).toBe(64);
    for (const params of requests) {
      expect(encodedParamLength(params)).toBeLessThanOrEqual(3_500);
      expect(stringArray(params.seriesIds).length).toBeLessThanOrEqual(64);
    }
  });

  it("derives affected bucket bounds from retention and rollup width", async () => {
    const bucketParams: Record<string, unknown>[] = [];
    const query: MetricClickHouseClient["query"] = async (request) => {
      if (!request.query.includes("{seriesIds:Array(String)}")) {
        bucketParams.push(request.query_params ?? {});
      }
      return response([]);
    };
    await repository(client({ query })).recomputeAffectedRollupsMany({
      points: [pointAt({ timeUnixMs: base + 1 })],
      retentionDays: 49,
    });

    // The near pass, then the wide one: this table is empty, so no bucket
    // resolves a predecessor within the hour.
    expect(bucketParams).toHaveLength(2);
    expect(Object.keys(bucketParams[0] ?? {}).sort()).toEqual(
      ["bucketMs", "from0", "lookbackFromMs", "lookbackToMs", "series0", "tenantId"].sort(),
    );
    // The bucket end and both lookback bounds are the same arithmetic on
    // either side of the wire, so they travel once as shared scalars.
    expect(bucketParams[0]?.bucketMs).toBe(METRIC_ROLLUP_INTERVAL_MS);
    expect(bucketParams[0]?.lookbackFromMs).toBe(60 * 60 * 1000);
    expect(bucketParams[0]?.lookbackToMs).toBe(0);
  });

  /** @scenario "A rollup bucket read asks only for the columns a rollup uses" */
  it("leaves behind every column the fold never reads", async () => {
    let bucketRead: string | undefined;
    const query: MetricClickHouseClient["query"] = async ({ query: sql }) => {
      if (!isSuccessorRead(sql)) bucketRead ??= sql;
      return response([]);
    };

    await repository(client({ query })).recomputeAffectedRollupsMany({
      points: [pointAt({ timeUnixMs: base + 1 })],
    });

    // FINAL materialises every selected column for every row a granule
    // covers, not for the rows returned, and this read returns on the order
    // of a hundred rows out of millions scanned. Each column here was being
    // decompressed millions of times and discarded; the server ran out of
    // memory inside one of them by name (`while reading column
    // PointAttributesJson`).
    for (const column of [
      "CanonicalPayload",
      "PointAttributesJson",
      "PointAttributeKeys",
      "ResourceAttributesJson",
      "ResourceAttributeKeys",
      "ScopeAttributesJson",
      "ScopeAttributeKeys",
      "SummaryQuantilesJson",
      "MetricDescription",
      "Flags",
      "_size_bytes",
      "OccurredAt",
      "AcceptedAt",
    ]) {
      expect(bucketRead).not.toContain(column);
    }
    // What a rollup is made of still arrives.
    for (const column of [
      "MetricKind",
      "AggregationTemporality",
      "ValueDouble",
      "BucketCounts",
      "ExplicitBounds",
      "StartTimeUnixNano",
    ]) {
      expect(bucketRead).toContain(column);
    }
  });

  /** @scenario "A rollup bucket read looks close before it looks far" */
  it("does not widen to retention when the near seek resolves", async () => {
    const { queries, client: reader } = readerWithPredecessor();

    await repository(reader).recomputeAffectedRollupsMany({
      points: [pointAt({ timeUnixMs: base + 1 })],
      retentionDays: 49,
    });

    // Successors, then one bucket read. A live series never opens the
    // partitions a retention-wide reverse seek would.
    expect(queries).toHaveLength(2);
  });

  /** @scenario "A rollup bucket read looks close before it looks far" */
  it("widens to the rest of retention only where the near seek found nothing", async () => {
    const reads: { sql: string; params: Record<string, unknown> }[] = [];
    const query: MetricClickHouseClient["query"] = async (request) => {
      if (!isSuccessorRead(request.query)) {
        reads.push({ sql: request.query, params: request.query_params ?? {} });
      }
      return response([]);
    };

    await repository(client({ query })).recomputeAffectedRollupsMany({
      points: [pointAt({ timeUnixMs: base + 1 })],
      retentionDays: 49,
    });

    expect(reads).toHaveLength(2);
    const [near, far] = reads;
    // The two windows abut and do not overlap, so together they are the one
    // retention-wide window this replaced: no row is read twice and none is
    // missed.
    expect(near!.params.lookbackToMs).toBe(0);
    expect(near!.params.lookbackFromMs).toBe(60 * 60 * 1000);
    expect(far!.params.lookbackToMs).toBe(near!.params.lookbackFromMs);
    expect(far!.params.lookbackFromMs).toBe(49 * 24 * 60 * 60 * 1000);
    // The far pass is only ever looking for a predecessor: the bucket's own
    // rows came back in the near pass, and asking again would double the
    // statement to return what it just returned.
    expect(far!.sql).not.toContain("UNION ALL");
    expect(far!.sql).toContain("DESC LIMIT 1");
  });

  it("keeps bucket seek parameters under the client URL ceiling", async () => {
    const bucketParams: Record<string, unknown>[] = [];
    const query: MetricClickHouseClient["query"] = async (request) => {
      if (!request.query.includes("{seriesIds:Array(String)}")) {
        bucketParams.push(request.query_params ?? {});
      }
      return response([]);
    };
    const points = Array.from({ length: 40 }, (_, index) =>
      pointAt({
        pointId: `${index}`.padStart(64, "0"),
        timeUnixMs: base + index * METRIC_ROLLUP_INTERVAL_MS,
      }),
    );

    await repository(client({ query })).recomputeAffectedRollupsMany({ points, retentionDays: 49 });

    expect(bucketParams.length).toBeGreaterThan(0);
    for (const params of bucketParams) expect(encodedParamLength(params)).toBeLessThan(4_096);
  });

  it("keeps successors tied to their own series across distant hours", async () => {
    const early = pointAt({ seriesId: "1".padStart(64, "0"), timeUnixMs: base + 1_000 });
    const late = pointAt({
      seriesId: "2".padStart(64, "0"),
      pointId: "2".repeat(64),
      timeUnixMs: base + 3_600_000 * 3 + 1_000,
    });
    const successorQueries: Record<string, unknown>[] = [];
    const query: MetricClickHouseClient["query"] = async (request) => {
      if (request.query.includes("{seriesIds:Array(String)}")) {
        successorQueries.push(request.query_params ?? {});
        return response([
          {
            SeriesId: early.seriesId,
            PointId: "3".repeat(64),
            TimeUnixMs: base + 2_000,
            TimeUnixNano: String(BigInt(base + 2_000) * 1_000_000n),
            MetricKind: early.metricKind,
            AggregationTemporality: early.aggregationTemporality,
          },
          {
            SeriesId: late.seriesId,
            PointId: "4".repeat(64),
            TimeUnixMs: late.timeUnixMs + 1_000,
            TimeUnixNano: String(BigInt(late.timeUnixMs + 1_000) * 1_000_000n),
            MetricKind: late.metricKind,
            AggregationTemporality: late.aggregationTemporality,
          },
        ]);
      }
      return response([]);
    };

    await repository(client({ query })).recomputeAffectedRollupsMany({
      points: [early, late],
    });

    expect(successorQueries).toHaveLength(1);
    expect(stringArray(successorQueries[0]?.seriesIds)).toEqual(
      expect.arrayContaining([early.seriesId, late.seriesId]),
    );
    expect(successorQueries[0]?.fromTimes).toEqual(
      expect.arrayContaining([early.timeUnixMs, late.timeUnixMs]),
    );
    expect(successorQueries[0]?.toTimes).toEqual(
      expect.arrayContaining([early.timeUnixMs, late.timeUnixMs]),
    );
  });

  it("reports the missing authoritative column and row identity", async () => {
    const pointToRead = pointAt({ timeUnixMs: base + 1_000 });
    const stored = MetricDataPointMapper.rawRow({ point: pointToRead, retentionDays: 30 });
    const { BucketCounts: _bucketCounts, ...missingBucketCounts } = stored;
    const query: MetricClickHouseClient["query"] = async (request) => {
      if (request.query.includes("{seriesIds:Array(String)}")) return response([]);
      return response([missingBucketCounts]);
    };

    await expect(
      repository(client({ query })).recomputeAffectedRollupsMany({ points: [pointToRead] }),
    ).rejects.toThrow(
      `missing the BucketCounts column (series ${pointToRead.seriesId}, point ${pointToRead.pointId})`,
    );
  });
});
