import { describe, expect, it } from "vitest";
import {
  DEFAULT_INGESTION_DAYS,
  DEFAULT_RETENTION_DAYS,
  resolveConfig,
} from "../domain/config.js";

describe("onboarding configuration", () => {
  describe("given only the base URL", () => {
    it("fills in the shipped defaults", () => {
      const config = resolveConfig({ appBaseUrl: "https://app.example.com" });

      expect(config.ingestionDays).toBe(DEFAULT_INGESTION_DAYS);
      expect(config.retentionDays).toBe(DEFAULT_RETENTION_DAYS);
      expect(config.provisioningEnabled).toBe(true);
    });
  });

  describe("given a deployment that tightened the limits", () => {
    /** @scenario "limits are configuration, not constants in a handler" */
    it("resolves every bucket's window and ceiling from configuration", () => {
      const config = resolveConfig({
        appBaseUrl: "https://app.example.com",
        rateLimits: {
          fingerprint: [{ windowSeconds: 60, max: 1 }],
          ip: [{ windowSeconds: 60, max: 2 }],
          ipSubnet: [{ windowSeconds: 60, max: 3 }],
          global: [{ windowSeconds: 60, max: 4 }],
          claimIp: [{ windowSeconds: 60, max: 5 }],
          claimFailure: [{ windowSeconds: 60, max: 6 }],
          pollIntervalSeconds: 9,
        },
      });

      // Every axis is data the deployment supplies, not a constant compiled
      // into a handler.
      expect(config.rateLimits.fingerprint[0]?.max).toBe(1);
      expect(config.rateLimits.global[0]?.max).toBe(4);
      expect(config.rateLimits.pollIntervalSeconds).toBe(9);
    });

    it("lets an operator turn the front door off entirely", () => {
      const config = resolveConfig({
        appBaseUrl: "https://app.example.com",
        provisioningEnabled: false,
      });

      expect(config.provisioningEnabled).toBe(false);
    });
  });
});
