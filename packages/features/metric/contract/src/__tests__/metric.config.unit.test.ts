import { RuntimeConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { metricServerConfigDefinition } from "../metric.config.ts";

describe("metric server configuration", () => {
  describe("given the metric pipeline's lane count", () => {
    /** @scenario "One variable has one owner across every process" */
    it("carries it as written, so producer and consumer clamp it identically", () => {
      expect(
        RuntimeConfig.create({
          name: "metric",
          definition: metricServerConfigDefinition,
          source: { METRIC_PROCESSING_SHARDS: "4" },
        }).value.processingShards,
      ).toBe("4");
    });
  });
});
