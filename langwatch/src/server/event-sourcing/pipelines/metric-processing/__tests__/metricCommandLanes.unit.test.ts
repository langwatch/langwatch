import { describe, expect, it } from "vitest";
import {
  metricCommandGroupKey,
  resolveMetricCommandShardCount,
} from "../canonical/shards";
import { createMetricProcessingPipeline } from "../pipeline";

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

  describe("when commands are registered on the real pipeline", () => {
    it("installs bounded lane routing", () => {
      const store = {} as never;
      const pipeline = createMetricProcessingPipeline({
        metricDataPointAppendStore: store,
        metricSeriesCatalogAppendStore: store,
        metricTimeRollupAppendStore: store,
        metricCommandShardCount: 8,
      });
      const command = pipeline.commands.find(
        (candidate) => candidate.name === "recordDataPoint",
      );
      const getGroupKey = command?.options?.getGroupKey;
      expect(getGroupKey).toBeDefined();

      const groups = new Set(
        Array.from({ length: 64 }, (_, index) =>
          getGroupKey!({
            pointId: index.toString(16).padStart(64, "0"),
          } as never),
        ),
      );
      expect(groups.size).toBeGreaterThan(1);
      for (const group of groups) {
        expect(group).toMatch(/^metric:[0-7]$/);
      }
    });
  });
});
