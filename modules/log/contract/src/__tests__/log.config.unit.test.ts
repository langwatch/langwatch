import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { logConfig } from "../log.config.ts";

describe("log server configuration", () => {
  describe("given the log pipeline's lane count", () => {
    /** @scenario "One variable has one owner across every process" */
    it("carries it as written, so producer and consumer clamp it identically", () => {
      const config = parseProcessConfig({
        owners: [{ name: "log", config: logConfig }],
        environment: { LOG_PROCESSING_SHARDS: "4" },
      });

      expect(config.log.processingShards).toBe("4");
    });
  });
});
