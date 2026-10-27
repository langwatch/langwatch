import { describe, expect, it, vi } from "vitest";

import { point } from "../../app/__tests__/metric.fixture.ts";
import { ClickHouseMetricDataPointAppendRepository } from "../../repositories/clickhouse/clickhouse.metric-data-point-append.repository.ts";
import type { MetricClickHouseClient } from "../../repositories/clickhouse/clickhouse.metric-data-point-append.repository.ts";
import { buildMetricProcessingPipeline } from "../metric.pipeline.ts";

function client(overrides: Partial<MetricClickHouseClient> = {}): MetricClickHouseClient {
  return {
    insert: async () => undefined,
    query: async () => ({ json: async () => [] }),
    ...overrides,
  };
}

describe("ClickHouseMetricProcessingAdapter", () => {
  describe("given a process holding only a tenant-keyed ClickHouse client", () => {
    /** @scenario "The processing pipeline composes from one tenant-keyed client" */
    it("builds the metric-processing pipeline from that client alone", () => {
      const resolveClient = vi.fn(async () => client());

      const pipeline = buildMetricProcessingPipeline({
        repository: ClickHouseMetricDataPointAppendRepository.create({
          resolveClient,
          defaultRetentionDays: 49,
        }),
        defaultRetentionDays: 49,
        metricCommandShardCount: 8,
      });

      expect(pipeline.metadata.name).toBe("metric_processing");
      expect(pipeline.commands.map((command) => command.definition.name)).toEqual([
        "recordDataPoint",
      ]);
      expect([...pipeline.mapProjections.keys()].toSorted()).toEqual([
        "metricDataPointStorage",
        "metricSeriesCatalog",
        "metricTimeRollup",
      ]);
    });

    /** @scenario "The processing pipeline composes from one tenant-keyed client" */
    it("appends through the tenant the point names", async () => {
      const insert = vi.fn<MetricClickHouseClient["insert"]>(async () => undefined);
      const resolveClient = vi.fn(async () => client({ insert }));

      await ClickHouseMetricDataPointAppendRepository.create({
        resolveClient,
        defaultRetentionDays: 49,
      }).ensureDataPoint({
        point: point({ tenantId: "project_alpha", timeUnixMs: 1_800_000_000_000 }),
      });

      expect(resolveClient).toHaveBeenCalledWith("project_alpha");
      expect(insert.mock.calls.map(([call]) => call.table)).toEqual([
        "metric_data_points",
        "metric_usage_estimates",
      ]);
    });
  });
});
