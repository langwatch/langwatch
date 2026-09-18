import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { dataRetentionConfig } from "../data-retention.config.ts";

describe("data retention server configuration", () => {
  describe("given a deployment overrides the platform default", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("carries the override as written for the cross-field rule to judge", () => {
      expect(
        parseProcessConfig({
          owners: [{ name: "data-retention", config: dataRetentionConfig }],
          environment: { LANGWATCH_DEFAULT_RETENTION_DAYS: "7" },
        })["data-retention"].platformDefaultDays,
      ).toBe("7");
    });
  });
});
