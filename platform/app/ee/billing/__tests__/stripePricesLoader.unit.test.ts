import { describe, expect, it } from "vitest";
import stripeCatalogData from "../stripe/stripeCatalog.json";
import {
  getStripeEnvironmentFromNodeEnv,
  parseStripePricesFile,
  resolveStripePriceMap,
} from "../stripe/stripePriceCatalog";
import {
  OPTIONAL_STRIPE_PRICE_NAMES,
  STRIPE_PRICE_NAMES,
} from "../stripe/stripePrices.types";

describe("stripeCatalog", () => {
  describe("parseStripePricesFile()", () => {
    /** @scenario Extra development prices do not break required mapping validation */
    it("parses the committed stripe catalog file", () => {
      const parsed = parseStripePricesFile(stripeCatalogData);

      expect(parsed.schemaVersion).toBe(1);
      // The optional names may be absent from the committed file until their
      // Stripe mode is provisioned by hand, so the floor is the required set
      // and the ceiling is every name.
      expect(Object.keys(parsed.mapping).length).toBeGreaterThanOrEqual(
        STRIPE_PRICE_NAMES.length - OPTIONAL_STRIPE_PRICE_NAMES.length,
      );
      expect(Object.keys(parsed.mapping).length).toBeLessThanOrEqual(
        STRIPE_PRICE_NAMES.length,
      );
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

      // A name the catalog does not map in this mode resolves to nothing,
      // which is the point of the optional list; every mapped one still has
      // to come back exactly as the file wrote it.
      for (const key of STRIPE_PRICE_NAMES) {
        expect(resolved[key]).toBe(parsed.mapping[key]?.test);
      }
    });

    /** @scenario Billing runtime resolves live price ids in production */
    it("resolves live mode mappings", () => {
      const parsed = parseStripePricesFile(stripeCatalogData);
      const resolved = resolveStripePriceMap(parsed, "live");

      for (const key of STRIPE_PRICE_NAMES) {
        expect(resolved[key]).toBe(parsed.mapping[key]?.live);
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
        if (OPTIONAL_STRIPE_PRICE_NAMES.includes(key)) continue;
        expect(resolved[key]).toBeDefined();
      }
    });

    it("keeps test and live ids different in the committed catalog file", () => {
      const parsed = parseStripePricesFile(stripeCatalogData);

      for (const key of STRIPE_PRICE_NAMES) {
        const mapping = parsed.mapping[key];
        if (!mapping) continue;
        expect(mapping.test).not.toBe(mapping.live);
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
