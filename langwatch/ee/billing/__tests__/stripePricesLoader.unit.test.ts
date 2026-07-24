import { describe, expect, it } from "vitest";
import stripeCatalogData from "../stripe/stripeCatalog.json";
import {
  getStripeEnvironmentFromNodeEnv,
  parseStripePricesFile,
  resolveStripePriceMap,
} from "../stripe/stripePriceCatalog";
import { STRIPE_PRICE_NAMES } from "../stripe/stripePrices.types";

describe("stripeCatalog", () => {
  describe("parseStripePricesFile()", () => {
    /** @scenario Extra development prices do not break required mapping validation */
    it("parses the committed stripe catalog file", () => {
      const parsed = parseStripePricesFile(stripeCatalogData);

      expect(parsed.schemaVersion).toBe(1);
      expect(Object.keys(parsed.mapping)).toHaveLength(STRIPE_PRICE_NAMES.length);
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

      expect(() => parseStripePricesFile(invalid)).toThrow(/PRO/);
    });
  });

  describe("resolveStripePriceMap()", () => {
    /** @scenario Billing runtime resolves test price ids outside production */
    it("resolves test mode mappings", () => {
      const parsed = parseStripePricesFile(stripeCatalogData);
      const resolved = resolveStripePriceMap(parsed, "test");

      for (const key of STRIPE_PRICE_NAMES) {
        expect(resolved[key]).toBe(parsed.mapping[key].test);
      }
    });

    /** @scenario Billing runtime resolves live price ids in production */
    it("resolves live mode mappings", () => {
      const parsed = parseStripePricesFile(stripeCatalogData);
      const resolved = resolveStripePriceMap(parsed, "live");

      for (const key of STRIPE_PRICE_NAMES) {
        expect(resolved[key]).toBe(parsed.mapping[key].live);
      }
    });

    /** @scenario "Extra development prices do not break required mapping validation" */
    it("accepts catalogs with additional non-required prices alongside required mappings", () => {
      const augmented = {
        ...stripeCatalogData,
        prices: {
          ...stripeCatalogData.prices,
          DEV_ONLY_PRICE_FOR_LOCAL_TESTING: {
            id: "price_dev_only_local_testing",
            active: false,
            livemode: false,
            product: null,
            unitAmount: 100,
            currency: "usd",
            type: "one_time" as const,
            recurring: null,
            nickname: null,
            lookupKey: null,
            metadata: {},
          },
        },
      };

      expect(() => parseStripePricesFile(augmented)).not.toThrow();

      const parsed = parseStripePricesFile(augmented);
      const resolved = resolveStripePriceMap(parsed, "test");
      for (const key of STRIPE_PRICE_NAMES) {
        expect(resolved[key]).toBeDefined();
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
