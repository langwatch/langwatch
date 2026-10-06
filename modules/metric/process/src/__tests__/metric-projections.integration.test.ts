import { randomUUID } from "node:crypto";

/**
 * @vitest-environment node
 * @integration
 * The pipeline's three map projections over one point, against the migrated ClickHouse schema.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { createTenantId } from "@langwatch/eventing";
import {
  METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
  METRIC_ROLLUP_INTERVAL_MS,
  metricDataPointReceivedEventSchema,
} from "@langwatch/metric-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { point } from "../app/__tests__/metric.fixture.ts";
import { MetricDataPointStorageMapProjection } from "../eventing/metric-data-point-storage.projection.ts";
import {
  MetricDataPointAppendStore,
  MetricSeriesCatalogAppendStore,
  MetricTimeRollupAppendStore,
} from "../eventing/metric-projection.store.ts";
import { MetricSeriesCatalogMapProjection } from "../eventing/metric-series-catalog.projection.ts";
import { MetricTimeRollupMapProjection } from "../eventing/metric-time-rollup.projection.ts";
import {
  ClickHouseMetricDataPointAppendRepository,
  type MetricClickHouseClient,
} from "../repositories/clickhouse/clickhouse.metric-data-point-append.repository.ts";
import { startMigratedClickHouse } from "./migrated-clickhouse.harness.ts";

const tag = randomUUID();
const tenantId = `${tag}-project`;
const seriesId = "d".repeat(64);
const bucketStart =
  Math.floor((Date.now() - 5 * 60_000) / METRIC_ROLLUP_INTERVAL_MS) * METRIC_ROLLUP_INTERVAL_MS;

const TABLES = [
  "metric_data_points",
  "metric_usage_estimates",
  "metric_series",
  "metric_time_rollups",
] as const;

let ch: ClickHouseClient;

/** The narrow port the append repository takes, over the real client. */
function metricClient(client: ClickHouseClient): MetricClickHouseClient {
  return {
    insert: async (params) => client.insert(params),
    query: async ({ unscoped: _unscoped, ...params }) => {
      const resultSet = await client.query(params);
      return {
        json: async <T>(): Promise<T[]> => {
          const parsed = await resultSet.json<T>();
          if (!Array.isArray(parsed)) throw new Error("Expected a JSONEachRow row array");
          return parsed;
        },
      };
    },
  };
}

async function rowsOf(table: (typeof TABLES)[number]): Promise<Record<string, unknown>[]> {
  const result = await ch.query({
    query: `SELECT * FROM ${table} FINAL WHERE TenantId = {tenantId:String}`,
    query_params: { tenantId },
    format: "JSONEachRow",
  });

  return result.json<Record<string, unknown>>();
}

beforeAll(async () => {
  ch = (await startMigratedClickHouse()).client;
  const port = metricClient(ch);
  const repository = ClickHouseMetricDataPointAppendRepository.create({
    resolveClient: async () => port,
    defaultRetentionDays: 30,
  });
  const deps = { shardCount: 8 };
  const data = point({
    tenantId,
    seriesId,
    timeUnixMs: bucketStart + 1_000,
    valueDouble: 4,
    acceptedAt: Date.now(),
  });
  const event = metricDataPointReceivedEventSchema.parse({
    id: "event-1",
    aggregateId: seriesId,
    aggregateType: "metric",
    tenantId: createTenantId(tenantId),
    createdAt: Date.now(),
    occurredAt: bucketStart + 1_000,
    type: METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
    version: "2026-01-01",
    data,
  });

  const context = { aggregateId: event.aggregateId, tenantId: event.tenantId };
  const projections = [
    MetricDataPointStorageMapProjection.create({
      ...deps,
      store: MetricDataPointAppendStore.create(repository, 30),
    }),
    MetricSeriesCatalogMapProjection.create({
      ...deps,
      store: MetricSeriesCatalogAppendStore.create(repository, 30),
    }),
    MetricTimeRollupMapProjection.create({
      ...deps,
      store: MetricTimeRollupAppendStore.create(repository, 30),
    }),
  ];

  for (const projection of projections) {
    await projection.store.append(projection.mapMetricDataPointReceived(event), context);
  }
}, 300_000);

afterAll(async () => {
  if (!ch) return;
  for (const table of TABLES) {
    await ch.command({
      query: `ALTER TABLE ${table} DELETE WHERE startsWith(TenantId, {tag:String})`,
      query_params: { tag },
    });
  }
});

describe("given a canonical metric data point for a known series", () => {
  describe("when the metric event projections process it", () => {
    /** @scenario "Metric projections preserve the four existing tables and rollup width" */
    it("writes the point to metric_data_points and metric_usage_estimates", async () => {
      expect(await rowsOf("metric_data_points")).toHaveLength(1);
      expect(await rowsOf("metric_usage_estimates")).toHaveLength(1);
    });

    /** @scenario "Metric projections preserve the four existing tables and rollup width" */
    it("writes the series to metric_series", async () => {
      expect(await rowsOf("metric_series")).toMatchObject([{ SeriesId: seriesId }]);
    });

    /** @scenario "Metric projections preserve the four existing tables and rollup width" */
    it("writes a 30 second rollup bucket to metric_time_rollups", async () => {
      const rollups = await rowsOf("metric_time_rollups");

      expect(METRIC_ROLLUP_INTERVAL_MS).toBe(30_000);
      expect(rollups).toHaveLength(1);
      expect(rollups).toMatchObject([{ SeriesId: seriesId }]);
      expect(
        new Date(`${String(rollups[0]?.["BucketEnd"]).replace(" ", "T")}Z`).getTime() -
          new Date(`${String(rollups[0]?.["BucketStart"]).replace(" ", "T")}Z`).getTime(),
      ).toBe(30_000);
    });
  });
});
