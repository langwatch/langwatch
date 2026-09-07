import { RuntimeConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { dataRetentionServerConfigDefinition } from "../data-retention.config.ts";

describe("data retention server configuration", () => {
  describe("given a deployment overrides the platform default", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("carries the override as written for the cross-field rule to judge", () => {
      expect(
        RuntimeConfig.create({
          name: "data-retention",
          definition: dataRetentionServerConfigDefinition,
          source: { LANGWATCH_DEFAULT_RETENTION_DAYS: "7" },
        }).value.platformDefaultDays,
      ).toBe("7");
    });
  });
});
