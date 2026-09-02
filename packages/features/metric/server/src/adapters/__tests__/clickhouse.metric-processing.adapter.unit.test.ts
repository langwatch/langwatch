import { describe, expect, it, vi } from "vitest";
import { point } from "@langwatch/metric-server/testing";
import { ClickHouseMetricProcessingAdapter } from "../clickhouse.metric-processing.adapter";
import { ClickHouseMetricDataPointAppendRepository } from "../../repositories/clickhouse/clickhouse.metric-data-point-append.repository";
import type { MetricClickHouseClient } from "../../repositories/clickhouse/clickhouse.metric-data-point-append.repository";
import { MetricDataPointClickHouseRepository } from "../../repositories/clickhouse/clickhouse.metric-data-point.repository";

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

      const pipeline = ClickHouseMetricProcessingAdapter.create({
        resolveClient,
        defaultRetentionDays: 49,
        metricCommandShardCount: 8,
      }).buildProcessing();

      expect(pipeline.metadata.name).toBe("metric_processing");
      expect(pipeline.commands.map((command) => command.name)).toEqual(["recordDataPoint"]);
      expect([...pipeline.mapProjections.keys()].sort()).toEqual([
        "metricDataPointStorage",
        "metricSeriesCatalog",
        "metricTimeRollup",
      ]);
    });

    /** @scenario "The processing pipeline composes from one tenant-keyed client" */
    it("mounts the dispatch subscribers it is handed under their own names", () => {
      const pipeline = ClickHouseMetricProcessingAdapter.create({
        resolveClient: async () => client(),
        defaultRetentionDays: 49,
        metricCommandShardCount: 8,
      }).buildProcessing({
        subscribers: [
          {
            name: "codingAgentMetricFactsDispatch",
            eventTypes: ["lw.obs.metric.data_point_received"],
            handle: async () => undefined,
          },
        ],
      });

      expect([...pipeline.eventSubscribers.keys()]).toEqual(["codingAgentMetricFactsDispatch"]);
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

  describe("given the port durable processing appends through", () => {
    /** @scenario "The append surface offers no read" */
    it("carries no usage-estimate query", () => {
      const appendOnly = ClickHouseMetricDataPointAppendRepository.create({
        resolveClient: async () => client(),
        defaultRetentionDays: 49,
      });

      // Named against the object rather than the type, because the type is
      // what a `resolveOrganizationClient` reintroduced here would satisfy
      // again without anything failing.
      expect("queryUsageEstimates" in appendOnly).toBe(false);
      expect("getSeriesTotalsByPointAttribute" in appendOnly).toBe(false);
    });
  });

  describe("given the full repository and the append-only one", () => {
    /** @scenario "Both graphs append through one implementation" */
    it("runs the same append path for both", async () => {
      const wideInsert = vi.fn<MetricClickHouseClient["insert"]>(async () => undefined);
      const narrowInsert = vi.fn<MetricClickHouseClient["insert"]>(async () => undefined);
      const sample = point({ tenantId: "project_alpha", timeUnixMs: 1_800_000_000_000 });

      await MetricDataPointClickHouseRepository.create({
        resolveClient: async () => client({ insert: wideInsert }),
        resolveOrganizationClient: async () => client(),
        defaultRetentionDays: 49,
      }).ensureDataPoint({ point: sample });
      await ClickHouseMetricDataPointAppendRepository.create({
        resolveClient: async () => client({ insert: narrowInsert }),
        defaultRetentionDays: 49,
      }).ensureDataPoint({ point: sample });

      expect(narrowInsert.mock.calls.map(([call]) => call)).toEqual(
        wideInsert.mock.calls.map(([call]) => call),
      );
    });
  });
});
