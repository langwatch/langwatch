import { InvalidRuntimeConfigError, RuntimeConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { automationServerConfigDefinition } from "../automation.config.ts";

const read = (source: Record<string, unknown>) =>
  RuntimeConfig.create({ name: "automation", definition: automationServerConfigDefinition, source })
    .value;

describe("automation server configuration", () => {
  describe("given a deployment overrides no ceiling", () => {
    /** @scenario "A feature's defaults are the values a deployment already runs on" */
    it("keeps the ceilings the product already runs on", () => {
      expect(read({})).toEqual({
        emailHourlyCap: 100,
        tenantDailyCap: 10_000,
        persistDailyCapFree: 50,
        persistDailyCapPaid: 500,
        persistDailyCapEnterprise: 5_000,
      });
    });
  });

  describe("given a ceiling is not a positive whole number", () => {
    /** @scenario "An unreadable switch is refused instead of read as off" */
    it("refuses the boot rather than running on a silent default", () => {
      expect(() => read({ TRIGGER_EMAIL_HOURLY_CAP: "many" })).toThrow(InvalidRuntimeConfigError);
      expect(() => read({ TRIGGER_PERSIST_DAILY_CAP_FREE: "0" })).toThrow(
        InvalidRuntimeConfigError,
      );
    });
  });
});
