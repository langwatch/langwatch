import { describe, expect, it } from "vitest";
import stripeCatalogData from "../stripeCatalog.json";
import {
  getStripeEnvironmentFromNodeEnv,
  parseStripePricesFile,
  resolveStripePriceMap,
} from "../stripePriceCatalog";
import { STRIPE_PRICE_NAMES } from "../stripePrices.types";

describe("stripeCatalog", () => {
  describe("parseStripePricesFile()", () => {
    it("parses the committed stripe catalog file", () => {
      const parsed = parseStripePricesFile(stripeCatalogData);

      expect(parsed.schemaVersion).toBe(1);
      expect(Object.keys(parsed.mapping)).toHaveLength(14);
      expect(Object.keys(parsed.prices).length).toBeGreaterThan(0);
    });

    it("fails when one required key mapping is missing", () => {
      const invalid = {
        ...stripeCatalogData,
        mapping: {
          ...stripeCatalogData.mapping,
        },
      } as Record<string, unknown>;

      delete (invalid.mapping as Record<string, unknown>).PRO;

      expect(() => parseStripePricesFile(invalid)).toThrow(
        "mapping.PRO must be an object",
      );
    });
  });

  describe("resolveStripePriceMap()", () => {
    it("resolves test mode mappings", () => {
      const parsed = parseStripePricesFile(stripeCatalogData);
      const resolved = resolveStripePriceMap(parsed, "test");

      for (const key of STRIPE_PRICE_NAMES) {
        expect(resolved[key]).toBe(parsed.mapping[key].test);
      }
    });

    it("resolves live mode mappings", () => {
      const parsed = parseStripePricesFile(stripeCatalogData);
      const resolved = resolveStripePriceMap(parsed, "live");

      for (const key of STRIPE_PRICE_NAMES) {
        expect(resolved[key]).toBe(parsed.mapping[key].live);
      }
    });

    it("keeps test and live ids different in the committed catalog file", () => {
      const parsed = parseStripePricesFile(stripeCatalogData);

      for (const key of STRIPE_PRICE_NAMES) {
        expect(parsed.mapping[key].test).not.toBe(parsed.mapping[key].live);
      }
    });
  });

  describe("getStripeEnvironmentFromNodeEnv()", () => {
    it("returns live when node env is production", () => {
      expect(getStripeEnvironmentFromNodeEnv("production")).toBe("live");
    });

    it("returns test when node env is not production", () => {
      expect(getStripeEnvironmentFromNodeEnv("development")).toBe("test");
      expect(getStripeEnvironmentFromNodeEnv("test")).toBe("test");
    });
  });
});
