import {
  STRIPE_METER_NAMES,
  STRIPE_PRICE_NAMES,
  type StripeEnvironment,
  type StripeMeterMap,
  type StripePriceDetail,
  type StripePriceMap,
  type StripePricesFile,
} from "@langwatch/enterprise-billing-contract";
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import {
  backfillCatalogDefaults,
  createEmptyCatalog,
  detectEnvironment,
  mergeWithExisting,
  normalizeMeterEventName,
  resolveRequiredMeterMappings,
  transformPrice,
  validateMappings,
} from "../stripe-prices-sync.task";

const createMapping = (
  testPrefix = "price_test",
  livePrefix = "price_live",
): StripePricesFile["mapping"] => {
  const mapping = {} as StripePricesFile["mapping"];
  for (const key of STRIPE_PRICE_NAMES) {
    mapping[key] = {
      test: `${testPrefix}_${key.toLowerCase()}`,
      live: `${livePrefix}_${key.toLowerCase()}`,
    };
  }
  return mapping;
};

const createMeterMapping = (
  testPrefix = "mtr_test",
  livePrefix = "mtr_live",
): StripePricesFile["meters"] => {
  const meters = {} as StripePricesFile["meters"];
  for (const key of STRIPE_METER_NAMES) {
    meters[key] = {
      test: `${testPrefix}_${key.toLowerCase()}`,
      live: `${livePrefix}_${key.toLowerCase()}`,
    };
  }
  return meters;
};

const createRequiredPriceRecords = (
  mapping: StripePriceMap,
  livemode: boolean,
): Record<string, StripePriceDetail> => {
  const record: Record<string, StripePriceDetail> = {};
  for (const key of STRIPE_PRICE_NAMES) {
    const id = mapping[key];
    record[id] = {
      id,
      active: true,
      livemode,
      product: "prod_demo",
      unitAmount: 100,
      currency: "usd",
      type: "recurring",
      recurring: { interval: "month", intervalCount: 1 },
      nickname: key,
      lookupKey: key,
      metadata: {},
    };
  }
  return record;
};

const createPriceMapForEnvironment = (
  mapping: StripePricesFile["mapping"],
  environment: StripeEnvironment,
): StripePriceMap => {
  const priceMap = {} as StripePriceMap;
  for (const key of STRIPE_PRICE_NAMES) {
    priceMap[key] = mapping[key][environment];
  }
  return priceMap;
};

const createStripePricesFile = (overrides?: Partial<StripePricesFile>): StripePricesFile => {
  const mapping = createMapping();
  const meters = createMeterMapping();
  return {
    schemaVersion: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    mapping,
    meters,
    prices: {
      ...createRequiredPriceRecords(createPriceMapForEnvironment(mapping, "test"), false),
      ...createRequiredPriceRecords(createPriceMapForEnvironment(mapping, "live"), true),
    },
    ...overrides,
  };
};

const createFakeMeter = (overrides?: Partial<Stripe.Billing.Meter>): Stripe.Billing.Meter => {
  return {
    id: "mtr_test_abc123",
    object: "billing.meter",
    created: 1700000000,
    display_name: "Billable Events",
    event_name: "langwatch_billable_events",
    event_time_window: null,
    livemode: false,
    status: "active",
    status_transitions: { deactivated_at: null },
    updated: 1700000000,
    customer_mapping: { event_payload_key: "stripe_customer_id", type: "by_id" },
    default_aggregation: { formula: "sum" },
    value_settings: { event_payload_key: "value" },
    ...overrides,
  } as Stripe.Billing.Meter;
};

describe("syncStripePrices", () => {
  describe("detectEnvironment()", () => {
    it("detects test mode keys", () => {
      expect(detectEnvironment("sk_test_123")).toBe("test");
      expect(detectEnvironment("rk_test_123")).toBe("test");
    });

    it("detects live mode keys", () => {
      expect(detectEnvironment("sk_live_123")).toBe("live");
      expect(detectEnvironment("rk_live_123")).toBe("live");
    });

    it("fails for unsupported key formats", () => {
      expect(() => detectEnvironment("pk_live_123")).toThrow(
        "STRIPE_SECRET_KEY must start with sk_test_, sk_live_, rk_test_, or rk_live_",
      );
    });
  });

  describe("transformPrice()", () => {
    it("maps recurring Stripe prices to persisted details", () => {
      const input = {
        id: "price_123",
        active: true,
        livemode: false,
        product: { id: "prod_123" },
        unit_amount: 9900,
        currency: "usd",
        type: "recurring",
        recurring: { interval: "month", interval_count: 1 },
        nickname: "Pro Monthly",
        lookup_key: "PRO",
        metadata: { langwatch_key: "PRO" },
      } as unknown as Stripe.Price;

      const result = transformPrice(input);

      expect(result).toEqual({
        id: "price_123",
        active: true,
        livemode: false,
        product: "prod_123",
        unitAmount: 9900,
        currency: "usd",
        type: "recurring",
        recurring: { interval: "month", intervalCount: 1 },
        nickname: "Pro Monthly",
        lookupKey: "PRO",
        metadata: { langwatch_key: "PRO" },
      });
    });

    it("maps one-time prices with null recurring", () => {
      const input = {
        id: "price_456",
        active: true,
        livemode: true,
        product: "prod_456",
        unit_amount: 500,
        currency: "usd",
        type: "one_time",
        recurring: null,
        nickname: null,
        lookup_key: null,
        metadata: {},
      } as unknown as Stripe.Price;

      const result = transformPrice(input);

      expect(result.recurring).toBeNull();
      expect(result.product).toBe("prod_456");
      expect(result.type).toBe("one_time");
    });
  });

  describe("createEmptyCatalog()", () => {
    it("includes empty meters for all STRIPE_METER_NAMES", () => {
      const catalog = createEmptyCatalog();
      for (const key of STRIPE_METER_NAMES) {
        expect(catalog.meters[key]).toEqual({ test: "", live: "" });
      }
    });

    it("includes empty mapping for all STRIPE_PRICE_NAMES", () => {
      const catalog = createEmptyCatalog();
      for (const key of STRIPE_PRICE_NAMES) {
        expect(catalog.mapping[key]).toEqual({ test: "", live: "" });
      }
    });
  });

  describe("backfillCatalogDefaults()", () => {
    it("adds empty meters when meters field is missing", () => {
      const raw = {
        schemaVersion: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
        mapping: createMapping(),
        prices: {},
      };

      const result = backfillCatalogDefaults(raw);

      expect(result.meters).toBeDefined();
      const meters = result.meters as StripePricesFile["meters"];
      for (const key of STRIPE_METER_NAMES) {
        expect(meters[key]).toEqual({ test: "", live: "" });
      }
    });

    it("preserves existing meters when present", () => {
      const existingMeters = createMeterMapping();
      const raw = {
        schemaVersion: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
        mapping: createMapping(),
        meters: existingMeters,
        prices: {},
      };

      const result = backfillCatalogDefaults(raw);

      expect(result.meters).toBe(existingMeters);
    });
  });

  describe("normalizeMeterEventName()", () => {
    it("strips langwatch_ prefix and uppercases", () => {
      expect(normalizeMeterEventName("langwatch_billable_events")).toBe("BILLABLE_EVENTS");
    });

    it("uppercases event_name without prefix", () => {
      expect(normalizeMeterEventName("billable_events")).toBe("BILLABLE_EVENTS");
    });

    it("handles already-uppercased names", () => {
      expect(normalizeMeterEventName("LANGWATCH_BILLABLE_EVENTS")).toBe("BILLABLE_EVENTS");
    });
  });

  describe("resolveRequiredMeterMappings()", () => {
    it("matches meters by normalized event_name with langwatch_ prefix", () => {
      const meter = createFakeMeter({
        id: "mtr_test_matched",
        event_name: "langwatch_billable_events",
        status: "active",
      });
      const result = resolveRequiredMeterMappings({ environment: "test", fetchedMeters: [meter] });

      expect(result.mapping.BILLABLE_EVENTS).toBe("mtr_test_matched");
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it("matches meters by event_name without prefix", () => {
      const meter = createFakeMeter({
        id: "mtr_test_no_prefix",
        event_name: "billable_events",
        status: "active",
      });
      const result = resolveRequiredMeterMappings({ environment: "test", fetchedMeters: [meter] });

      expect(result.mapping.BILLABLE_EVENTS).toBe("mtr_test_no_prefix");
      expect(result.errors).toEqual([]);
    });

    it("errors when a required meter has no match", () => {
      const result = resolveRequiredMeterMappings({ environment: "test", fetchedMeters: [] });

      expect(result.errors).toHaveLength(STRIPE_METER_NAMES.length);
      expect(result.errors[0]).toContain("Missing required meter mapping");
    });

    it("prefers active meters over inactive", () => {
      const inactive = createFakeMeter({
        id: "mtr_test_inactive",
        event_name: "langwatch_billable_events",
        status: "inactive",
      });
      const active = createFakeMeter({
        id: "mtr_test_active",
        event_name: "langwatch_billable_events",
        status: "active",
      });
      const result = resolveRequiredMeterMappings({
        environment: "test",
        fetchedMeters: [inactive, active],
      });

      expect(result.mapping.BILLABLE_EVENTS).toBe("mtr_test_active");
      expect(result.warnings).toEqual([]);
    });

    it("warns when matched meter is inactive", () => {
      const inactive = createFakeMeter({
        id: "mtr_test_inactive",
        event_name: "langwatch_billable_events",
        status: "inactive",
      });
      const result = resolveRequiredMeterMappings({
        environment: "test",
        fetchedMeters: [inactive],
      });

      expect(result.mapping.BILLABLE_EVENTS).toBe("mtr_test_inactive");
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("inactive meter");
    });
  });

  describe("mergeWithExisting()", () => {
    it("updates current mode and preserves opposite mode mapping and prices", () => {
      const existing = createStripePricesFile();

      const resolvedMapping = {} as StripePriceMap;
      for (const key of STRIPE_PRICE_NAMES) {
        resolvedMapping[key] = `price_test_next_${key.toLowerCase()}`;
      }

      const resolvedMeterMapping = {} as StripeMeterMap;
      for (const key of STRIPE_METER_NAMES) {
        resolvedMeterMapping[key] = `mtr_test_next_${key.toLowerCase()}`;
      }

      const fetchedPricesById = createRequiredPriceRecords(resolvedMapping, false);

      const merged = mergeWithExisting({
        existing,
        environment: "test",
        fetchedPricesById,
        resolvedMapping,
        resolvedMeterMapping,
      });

      for (const key of STRIPE_PRICE_NAMES) {
        expect(merged.mapping[key].test).toBe(resolvedMapping[key]);
        expect(merged.mapping[key].live).toBe(existing.mapping[key].live);
      }

      const livePrices = Object.values(merged.prices).filter((price) => price.livemode);
      const testPrices = Object.values(merged.prices).filter((price) => !price.livemode);

      expect(livePrices).toHaveLength(STRIPE_PRICE_NAMES.length);
      expect(testPrices).toHaveLength(STRIPE_PRICE_NAMES.length);
    });

    it("updates current mode meters and preserves opposite mode meter IDs", () => {
      const existing = createStripePricesFile();
      const resolvedMapping = createPriceMapForEnvironment(existing.mapping, "test");
      const resolvedMeterMapping = {} as StripeMeterMap;
      for (const key of STRIPE_METER_NAMES) {
        resolvedMeterMapping[key] = `mtr_test_next_${key.toLowerCase()}`;
      }

      const fetchedPricesById = createRequiredPriceRecords(resolvedMapping, false);

      const merged = mergeWithExisting({
        existing,
        environment: "test",
        fetchedPricesById,
        resolvedMapping,
        resolvedMeterMapping,
      });

      for (const key of STRIPE_METER_NAMES) {
        expect(merged.meters[key].test).toBe(resolvedMeterMapping[key]);
        expect(merged.meters[key].live).toBe(existing.meters[key].live);
      }
    });

    it("defaults to empty strings when existing catalog has no meters", () => {
      const existing = createStripePricesFile();
      const existingWithoutMeters = {
        ...existing,
        meters: undefined,
      } as unknown as StripePricesFile;

      const resolvedMapping = createPriceMapForEnvironment(existing.mapping, "test");
      const resolvedMeterMapping = {} as StripeMeterMap;
      for (const key of STRIPE_METER_NAMES) {
        resolvedMeterMapping[key] = `mtr_test_new_${key.toLowerCase()}`;
      }

      const fetchedPricesById = createRequiredPriceRecords(resolvedMapping, false);

      const merged = mergeWithExisting({
        existing: existingWithoutMeters,
        environment: "test",
        fetchedPricesById,
        resolvedMapping,
        resolvedMeterMapping,
      });

      for (const key of STRIPE_METER_NAMES) {
        expect(merged.meters[key].test).toBe(resolvedMeterMapping[key]);
        expect(merged.meters[key].live).toBe("");
      }
    });
  });

  describe("validateMappings()", () => {
    it("returns no errors for complete mappings", () => {
      const file = createStripePricesFile();

      expect(validateMappings(file, "test")).toEqual([]);
      expect(validateMappings(file, "live")).toEqual([]);
    });

    it("reports missing mapped prices", () => {
      const mapping = createMapping();
      const testMap = createPriceMapForEnvironment(mapping, "test");
      const file = createStripePricesFile({
        mapping,
        prices: { ...createRequiredPriceRecords(testMap, false) },
      });

      const key = STRIPE_PRICE_NAMES[0];
      delete file.prices[testMap[key]];

      const errors = validateMappings(file, "test");
      expect(errors.some((error) => error.includes("references missing price"))).toBe(true);
    });
  });
});
