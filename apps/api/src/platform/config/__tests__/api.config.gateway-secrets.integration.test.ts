import { describe, expect, it } from "vitest";
import { resolveApiConfig } from "../api.config";

/**
 * The environment a fresh clone boots with: `.env.example` ships the three
 * gateway secrets as commented sentinels, so a developer who copies it and
 * changes nothing arrives here having stated none of them.
 */
const FRESH_CLONE_SOURCE = {
  NODE_ENV: "development",
  API_PORT: "6560",
  DATABASE_URL: "postgresql://localhost:5432/langwatch",
  REDIS_URL: "redis://localhost:6379",
} as const;

const provisioned = (label: string): string => label.padEnd(32, "0");

describe("given a deployment resolving the API process configuration", () => {
  describe("when it states no gateway secret at all", () => {
    /** @scenario "A fresh clone with no gateway secrets set boots clean" */
    it("resolves without requiring one", () => {
      const config = resolveApiConfig(FRESH_CLONE_SOURCE);

      expect(config.gatewayInternalSecret).toBeUndefined();
      expect(config.gatewayJwtSecret).toBeUndefined();
      expect(config.virtualKeyPepper).toBeUndefined();
    });
  });

  describe("when it states only one of them", () => {
    it("refuses to resolve", () => {
      expect(() =>
        resolveApiConfig({
          ...FRESH_CLONE_SOURCE,
          LW_GATEWAY_INTERNAL_SECRET: provisioned("internal"),
        }),
      ).toThrow(/LW_GATEWAY_JWT_SECRET/);
    });
  });

  describe("when it states all three", () => {
    it("resolves them onto the configuration", () => {
      const config = resolveApiConfig({
        ...FRESH_CLONE_SOURCE,
        LW_GATEWAY_INTERNAL_SECRET: provisioned("internal"),
        LW_GATEWAY_JWT_SECRET: provisioned("jwt"),
        LW_VIRTUAL_KEY_PEPPER: provisioned("pepper"),
      });

      expect(config.gatewayInternalSecret).toBe(provisioned("internal"));
      expect(config.gatewayJwtSecret).toBe(provisioned("jwt"));
      expect(config.virtualKeyPepper).toBe(provisioned("pepper"));
    });
  });
});
