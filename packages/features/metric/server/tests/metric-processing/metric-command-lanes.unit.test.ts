import { describe, expect, it } from "vitest";
import { metricDataPointReceivedEventSchema } from "@langwatch/metric-contract";
import { point } from "@langwatch/metric-server/testing";
import {
  metricCommandGroupKey,
  metricMapGroupKey,
  resolveMetricCommandShardCount,
} from "../../src/adapters/metric-processing.adapter";
import { createMetricProcessingPipeline } from "../../src/adapters/metric-processing.adapter";

describe("metric command lanes", () => {
  describe("when the shard count comes from configuration", () => {
    it("clamps to 1-128 and always returns a bounded non-empty lane", () => {
      expect(resolveMetricCommandShardCount("0")).toBe(1);
      expect(resolveMetricCommandShardCount("1000")).toBe(128);
      expect(resolveMetricCommandShardCount("bad")).toBe(16);
      const pointId = "a".repeat(64);
      expect(metricCommandGroupKey({ pointId, shardCount: 16 })).toMatch(
        /^metric:(?:[0-9]|1[0-5])$/,
      );
      expect(metricCommandGroupKey({ pointId, shardCount: 16 })).toBe(
        metricCommandGroupKey({ pointId, shardCount: 16 }),
      );
    });
  });

  describe("when map projections route points", () => {
    it("uses point lanes for storage and series lanes for mutable derivatives", () => {
      const store = { append: async () => undefined };
      const pipeline = createMetricProcessingPipeline({
        metricDataPointAppendStore: store,
        metricSeriesCatalogAppendStore: store,
        metricTimeRollupAppendStore: store,
        metricCommandShardCount: 8,
      });
      const event = metricDataPointReceivedEventSchema.parse({
        id: "event",
        aggregateId: "a".repeat(64),
        aggregateType: "metric",
        tenantId: "project_1",
        createdAt: 1,
        occurredAt: 1,
        type: "lw.obs.metric.data_point_received",
        version: "2026-07-15",
        data: point({
          tenantId: "project_1",
          pointId: "a".repeat(64),
          seriesId: "b".repeat(64),
          timeUnixMs: 1_700_000_000_000,
        }),
      });

      const storage =
        pipeline.mapProjections.get("metricDataPointStorage")?.definition.options?.groupKeyFn;
      const catalog =
        pipeline.mapProjections.get("metricSeriesCatalog")?.definition.options?.groupKeyFn;
      const rollup =
        pipeline.mapProjections.get("metricTimeRollup")?.definition.options?.groupKeyFn;

      expect(storage?.(event)).toBe(metricMapGroupKey({ identity: "a".repeat(64), shardCount: 8 }));
      expect(catalog?.(event)).toBe(metricMapGroupKey({ identity: "b".repeat(64), shardCount: 8 }));
      expect(rollup?.(event)).toBe(catalog?.(event));
    });
  });

  describe("when commands are registered on the real pipeline", () => {
    it("installs bounded lane routing", () => {
      const store = { append: async () => undefined };
      const pipeline = createMetricProcessingPipeline({
        metricDataPointAppendStore: store,
        metricSeriesCatalogAppendStore: store,
        metricTimeRollupAppendStore: store,
        metricCommandShardCount: 8,
      });
      const command = pipeline.commands.find((candidate) => candidate.name === "recordDataPoint");
      const getGroupKey = command?.options?.getGroupKey;
      expect(getGroupKey).toBeDefined();

      const groups = new Set(
        Array.from({ length: 64 }, (_, index) =>
          getGroupKey!(
            point({
              pointId: index.toString(16).padStart(64, "0"),
              timeUnixMs: 1_700_000_000_000 + index,
            }),
          ),
        ),
      );
      expect(groups.size).toBeGreaterThan(1);
      for (const group of groups) {
        expect(group).toMatch(/^metric:[0-7]$/);
      }
    });
  });
});
