import { describe, expect, it, vi } from "vitest";
import type { CanonicalMetricDataPoint } from "~/server/event-sourcing/pipelines/metric-processing/schemas/metricDataPoint";
import { MetricDataPointClickHouseRepository } from "../metric-data-point.clickhouse.repository";

function dataPoint(): CanonicalMetricDataPoint {
  return {
    tenantId: "project-1",
    organizationId: "organization-1",
    pointId: "a".repeat(64),
    seriesId: "b".repeat(64),
    resourceSchemaUrl: "",
    resourceAttributesJson: "[]",
    resourceAttributeKeys: [],
    scopeSchemaUrl: "",
    scopeName: "scope",
    scopeVersion: "",
    scopeAttributesJson: "[]",
    scopeAttributeKeys: [],
    metricName: "requests",
    metricDescription: "",
    metricUnit: "1",
    metricKind: "gauge",
    aggregationTemporality: "unspecified",
    isMonotonic: null,
    pointAttributesJson: "[]",
    pointAttributeKeys: [],
    startTimeUnixNano: "0",
    timeUnixNano: "1700000000000000000",
    timeUnixMs: 1_700_000_000_000,
    flags: 0,
    valueType: "double",
    valueInt: null,
    valueDouble: 1.5,
    count: null,
    sum: null,
    min: null,
    max: null,
    explicitBounds: [],
    bucketCounts: [],
    exponentialScale: null,
    exponentialZeroThreshold: null,
    zeroCount: null,
    positiveOffset: null,
    positiveBucketCounts: [],
    negativeOffset: null,
    negativeBucketCounts: [],
    summaryQuantilesJson: "[]",
    canonicalPayload: '{"point":{"value":1.5}}',
    canonicalSizeBytes: 23,
    occurredAt: 1_700_000_000_000,
    acceptedAt: 1_800_000_000_000,
  };
}

describe("MetricDataPointClickHouseRepository", () => {
  it("writes authoritative raw data before a payload-free shadow estimate", async () => {
    const insert = vi.fn<
      (args: { table: string; values: unknown[] }) => Promise<void>
    >(async () => {});
    const client = { insert } as never;
    const repository = new MetricDataPointClickHouseRepository(
      async () => client,
      async () => client,
    );

    await repository.ensureDataPoint({ point: dataPoint(), retentionDays: 49 });

    expect(insert.mock.calls.map((call) => call[0].table)).toEqual([
      "metric_data_points",
      "metric_usage_estimates",
    ]);
    const raw = insert.mock.calls[0]![0].values[0] as Record<string, unknown>;
    expect(raw).toMatchObject({
      TenantId: "project-1",
      OccurredAt: new Date(1_700_000_000_000),
      AcceptedAt: new Date(1_800_000_000_000),
    });
    expect(raw).not.toHaveProperty("OrganizationId");
    expect(raw).not.toHaveProperty("WrittenAt");
    const shadow = insert.mock.calls[1]![0].values[0] as Record<
      string,
      unknown
    >;
    expect(shadow).toMatchObject({
      OrganizationId: "organization-1",
      TenantId: "project-1",
      PointId: "a".repeat(64),
      SeriesId: "b".repeat(64),
      MetricName: "requests",
      CanonicalSourceBytes: 23,
    });
    expect(Object.keys(shadow).sort()).toEqual(
      [
        "AcceptedHour",
        "AcceptedAt",
        "CanonicalSourceBytes",
        "DedupVersion",
        "MetricName",
        "OrganizationId",
        "PointId",
        "SeriesId",
        "TenantId",
      ].sort(),
    );
    expect(shadow).not.toHaveProperty("WrittenAt");
  });

  describe("when a replay chunk is written", () => {
    it("sends one insert per table rather than one per point", async () => {
      const insert = vi.fn<
        (args: { table: string; values: unknown[] }) => Promise<void>
      >(async () => {});
      const client = { insert } as never;
      const repository = new MetricDataPointClickHouseRepository(
        async () => client,
        async () => client,
      );
      const points = [
        { ...dataPoint(), pointId: "a".repeat(64), timeUnixMs: 1 },
        { ...dataPoint(), pointId: "b".repeat(64), timeUnixMs: 2 },
        { ...dataPoint(), pointId: "c".repeat(64), timeUnixMs: 3 },
      ];

      await repository.ensureDataPoints({ points, retentionDays: 49 });

      expect(insert).toHaveBeenCalledTimes(2);
      expect(insert.mock.calls.map((call) => call[0].table)).toEqual([
        "metric_data_points",
        "metric_usage_estimates",
      ]);
      expect(insert.mock.calls[0]![0].values).toHaveLength(3);
      expect(insert.mock.calls[1]![0].values).toHaveLength(3);
    });

    it("collapses a series to its newest point, which is the only one that can win", async () => {
      const insert = vi.fn<
        (args: { table: string; values: unknown[] }) => Promise<void>
      >(async () => {});
      const client = { insert } as never;
      const repository = new MetricDataPointClickHouseRepository(
        async () => client,
        async () => client,
      );
      const base = dataPoint();
      const points = [
        { ...base, pointId: "a".repeat(64), timeUnixMs: 1_000 },
        { ...base, pointId: "b".repeat(64), timeUnixMs: 3_000 },
        { ...base, pointId: "c".repeat(64), timeUnixMs: 2_000 },
      ];

      await repository.upsertSeriesMany({ points, retentionDays: 49 });

      expect(insert).toHaveBeenCalledOnce();
      const values = insert.mock.calls[0]![0].values as Array<
        Record<string, unknown>
      >;
      expect(values).toHaveLength(1);
      expect(values[0]).toMatchObject({ LastSeenAt: new Date(3_000) });
    });
  });

  it("uses PointId-deduplicated analysis and organization-aware routing", async () => {
    const query = vi.fn<
      (args: { query: string }) => Promise<{ json: () => Promise<unknown[]> }>
    >(async () => ({
      json: async () => [
        {
          OrganizationId: "organization-1",
          UniqueActiveSeries: "2",
          ActiveSeriesHours: "3",
          AcceptedPoints: "5",
          CanonicalRetainedBytes: "123",
          ProjectedEventEquivalentUsage: "3",
        },
      ],
    }));
    const projectResolver = vi.fn(async () => ({ query }) as never);
    const organizationResolver = vi.fn(async () => ({ query }) as never);
    const repository = new MetricDataPointClickHouseRepository(
      projectResolver,
      organizationResolver,
    );

    const result = await repository.queryUsageEstimates({
      organizationId: "organization-1",
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-02-01T00:00:00Z"),
      groupBy: "organization",
    });

    expect(projectResolver).not.toHaveBeenCalled();
    expect(organizationResolver).toHaveBeenCalledWith("organization-1");
    expect(query.mock.calls[0]![0].query).toContain("GROUP BY PointId");
    expect(query.mock.calls[0]![0].query).toContain(
      "HAVING min(AcceptedAt) >= {from:DateTime64(3)}",
    );
    expect(query.mock.calls[0]![0].query).toContain(
      "uniqExact(tuple(SeriesId, AcceptedHour))",
    );
    // Pins the isolation carve-out in clickhouse-queries.md: the shadow ledger
    // is organization-scoped, so OrganizationId leads the predicate and no
    // TenantId filter is applied when no tenant was asked for.
    expect(query.mock.calls[0]![0].query).toContain(
      "WHERE OrganizationId = {organizationId:String}",
    );
    expect(query.mock.calls[0]![0].query).not.toContain(
      "TenantId = {tenantId:String}",
    );
    expect(result).toEqual([
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
  });
});
