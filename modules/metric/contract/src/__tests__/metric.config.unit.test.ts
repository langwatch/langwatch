import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { metricConfig } from "../metric.config.ts";

describe("metric server configuration", () => {
  describe("given the metric pipeline's lane count", () => {
    /** @scenario "One variable has one owner across every process" */
    it("carries it as written, so producer and consumer clamp it identically", () => {
      const config = parseProcessConfig({
        owners: [{ name: "metric", config: metricConfig }],
        environment: { METRIC_PROCESSING_SHARDS: "4" },
      });

      expect(config.metric.processingShards).toBe("4");
    });
  });
});
