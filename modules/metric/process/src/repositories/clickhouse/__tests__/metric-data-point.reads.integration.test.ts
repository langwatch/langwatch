/** @vitest-environment node */
/** Spec: modules/metric/specs/metric-processing.feature */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { startTestClickHouseEndpoints } from "@langwatch/clickhouse-client/testing";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MetricClickHouseClient } from "../clickhouse.metric-data-point-append.repository.ts";
import { MetricDataPointClickHouseRepository } from "../clickhouse.metric-data-point.repository.ts";

const ORGANIZATION = "organization_reads";
const TENANT = "tenant_reads";
const SERIES_A = "a".repeat(64);
const SERIES_B = "b".repeat(64);

/** The columns the two reads touch, with the shipped types, engines and sort keys. */
const CREATE_TABLES = [
  `CREATE TABLE metric_usage_estimates (
    OrganizationId String, TenantId String, PointId FixedString(64),
    SeriesId FixedString(64), MetricName String, AcceptedAt DateTime64(3),
    AcceptedHour DateTime, CanonicalSourceBytes UInt32, DedupVersion UInt64
  ) ENGINE = ReplacingMergeTree(DedupVersion)
  PARTITION BY toYYYYMM(AcceptedAt) ORDER BY (OrganizationId, TenantId, PointId)`,
  `CREATE TABLE metric_series (
    TenantId String, SeriesId FixedString(64), MetricName String,
    PointAttributesJson String, PointAttributeKeys Array(String), LastSeenAt DateTime64(3)
  ) ENGINE = ReplacingMergeTree(LastSeenAt)
  PARTITION BY toYearWeek(LastSeenAt) ORDER BY (TenantId, SeriesId)`,
  `CREATE TABLE metric_time_rollups (
    TenantId String, SeriesId FixedString(64), BucketStart DateTime64(3), Sum Nullable(Float64)
  ) ENGINE = MergeTree ORDER BY (TenantId, SeriesId, BucketStart)`,
];
const TABLES = ["metric_usage_estimates", "metric_series", "metric_time_rollups"];

function usageRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    OrganizationId: ORGANIZATION,
    TenantId: TENANT,
    SeriesId: SERIES_A,
    MetricName: "requests",
    AcceptedAt: "2026-01-10 10:15:00.000",
    AcceptedHour: "2026-01-10 10:00:00",
    CanonicalSourceBytes: 100,
    DedupVersion: 1,
    ...overrides,
  };
}

function seriesRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    TenantId: TENANT,
    MetricName: "requests",
    PointAttributeKeys: ["team"],
    LastSeenAt: "2026-01-10 10:15:00.000",
    ...overrides,
  };
}

let client: ClickHouseClient;

function repository(): MetricDataPointClickHouseRepository {
  const adapter: MetricClickHouseClient = {
    insert: async () => undefined,
    query: async ({ query, query_params }) => {
      const result = await client.query({ query, query_params, format: "JSONEachRow" });
      return { json: async <T>() => result.json<T>() };
    },
  };
  return MetricDataPointClickHouseRepository.create({
    resolveClient: async () => adapter,
    resolveOrganizationClient: async () => adapter,
    defaultRetentionDays: 30,
  });
}

describe("given metric rows stored in ClickHouse", () => {
  beforeAll(async () => {
    const [endpoint] = await startTestClickHouseEndpoints({
      suite: "metric-data-point-reads",
      names: ["shared"],
      environment: process.env,
    });
    client = createClient({ url: endpoint!.url });
    // The endpoint is reused across runs, so start from empty tables.
    for (const table of TABLES) {
      await client.command({ query: `DROP TABLE IF EXISTS ${table} SYNC` });
    }
    for (const query of CREATE_TABLES) await client.command({ query });
    await client.insert({
      table: "metric_usage_estimates",
      format: "JSONEachRow",
      values: [
        usageRow({ PointId: "1".repeat(64) }),
        usageRow({ PointId: "2".repeat(64), SeriesId: SERIES_B, CanonicalSourceBytes: 50 }),
        // The first point accepted a second time: a second ledger row for one PointId.
        usageRow({
          PointId: "1".repeat(64),
          AcceptedAt: "2026-01-12 08:00:00.000",
          AcceptedHour: "2026-01-12 08:00:00",
          DedupVersion: 2,
        }),
        // Accepted before the window: billed in an earlier one, so not counted here.
        usageRow({ PointId: "3".repeat(64), AcceptedAt: "2025-12-20 09:00:00.000" }),
      ],
    });
    await client.insert({
      table: "metric_series",
      format: "JSONEachRow",
      values: [
        seriesRow({ SeriesId: SERIES_A, PointAttributesJson: '{"team":"alpha"}' }),
        seriesRow({ SeriesId: SERIES_B, PointAttributesJson: '{"team":"beta"}' }),
      ],
    });
    await client.insert({
      table: "metric_time_rollups",
      format: "JSONEachRow",
      values: [
        { TenantId: TENANT, SeriesId: SERIES_A, BucketStart: "2026-01-10 10:00:00.000", Sum: 3 },
        { TenantId: TENANT, SeriesId: SERIES_A, BucketStart: "2026-01-10 10:01:00.000", Sum: 4 },
        { TenantId: TENANT, SeriesId: SERIES_B, BucketStart: "2026-01-10 10:00:00.000", Sum: 9 },
      ],
    });
  }, 120_000);

  afterAll(async () => {
    await client?.close();
  });

  describe("when the usage estimates are read for a window", () => {
    /** @scenario "The usage estimate read runs against ClickHouse" */
    it("counts each point first accepted inside the window once", async () => {
      const result = await repository().queryUsageEstimates({
        organizationId: ORGANIZATION,
        from: Temporal.Instant.from("2026-01-01T00:00:00Z"),
        to: Temporal.Instant.from("2026-02-01T00:00:00Z"),
        groupBy: "organization",
      });

      expect(result).toEqual([
        expect.objectContaining({
          organizationId: ORGANIZATION,
          acceptedPoints: 2,
          uniqueActiveSeries: 2,
          canonicalRetainedBytes: 150,
        }),
      ]);
    });
  });

  describe("when series totals are read by an attribute value no series carries", () => {
    it("returns no series", async () => {
      const result = await repository().findSeriesTotalsByPointAttribute({
        tenantId: TENANT,
        attributeKey: "team",
        attributeValue: "gamma",
        fromMs: Date.parse("2026-01-01T00:00:00Z"),
      });

      expect(result).toEqual([]);
    });
  });

  describe("when series totals are read by a point attribute", () => {
    /** @scenario "Series totals are read by a point attribute" */
    it("returns only the matching series with the sum of its rollups", async () => {
      const result = await repository().findSeriesTotalsByPointAttribute({
        tenantId: TENANT,
        attributeKey: "team",
        attributeValue: "alpha",
        fromMs: Date.parse("2026-01-01T00:00:00Z"),
      });

      expect(result).toEqual([
        { metricName: "requests", pointAttributes: { team: "alpha" }, total: 7 },
      ]);
    });
  });
});
