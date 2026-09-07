import { RuntimeConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { logServerConfigDefinition } from "../log.config.ts";

describe("log server configuration", () => {
  describe("given the log pipeline's lane count", () => {
    /** @scenario "One variable has one owner across every process" */
    it("carries it as written, so producer and consumer clamp it identically", () => {
      expect(
        RuntimeConfig.create({
          name: "log",
          definition: logServerConfigDefinition,
          source: { LOG_PROCESSING_SHARDS: "4" },
        }).value.processingShards,
      ).toBe("4");
    });
  });
});
