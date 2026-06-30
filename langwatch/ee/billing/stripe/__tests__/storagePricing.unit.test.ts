/**
 * Price-pin guard for ADR-027 storage billing. These constants ARE the pricing
 * contract; a silent edit here (or a divergent catalog `unit_amount_decimal`)
 * would mis-bill every customer. The test pins the headline, the derived unit
 * price, and the round-trip so a change forces an explicit, reviewed update.
 *
 * @see specs/data-retention/storage-billing-pricing.feature
 */

import { describe, expect, it } from "vitest";
import {
  STORAGE_EUR_PER_GIB_DAY,
  STORAGE_EUR_PER_GIB_MONTH,
  STORAGE_EUR_PER_MIB_HOUR,
  STORAGE_METER_AGGREGATION,
  STORAGE_METER_EVENT_NAME,
  STORAGE_UNIT_AMOUNT_DECIMAL_CENTS_PER_MIB_HOUR,
} from "../storagePricing";

describe("ADR-027 storage pricing", () => {
  describe("given the headline price", () => {
    /** @scenario The headline storage price is €3 per logical GiB-month */
    it("is €3 per GiB-month on the 30-day convention", () => {
      expect(STORAGE_EUR_PER_GIB_MONTH).toBe(3);
    });
  });

  describe("when the per-MiB-hour unit price is derived", () => {
    /** @scenario The unit price derives from the headline by the documented formula */
    it("equals headline / (30 days × 24 hours × 1024 MiB)", () => {
      expect(STORAGE_EUR_PER_MIB_HOUR).toBe(3 / (30 * 24 * 1024));
      // ≈ €0.00000407 per MiB-hour (the ADR headline).
      expect(STORAGE_EUR_PER_MIB_HOUR).toBeCloseTo(0.00000407, 8);
    });

    /** @scenario The Stripe unit_amount_decimal is pinned in cents per MiB-hour */
    it("pins unit_amount_decimal to cents per MiB-hour so the catalog can't drift", () => {
      expect(STORAGE_UNIT_AMOUNT_DECIMAL_CENTS_PER_MIB_HOUR).toBe(
        STORAGE_EUR_PER_MIB_HOUR * 100,
      );
      // ≈ 0.0004069 cents per MiB-hour.
      expect(STORAGE_UNIT_AMOUNT_DECIMAL_CENTS_PER_MIB_HOUR).toBeCloseTo(
        0.0004069,
        7,
      );
    });
  });

  describe("when the headline is reconstructed from the unit price", () => {
    /** @scenario The unit price round-trips to the €0.10 per GiB-day headline */
    it("yields €0.10 per GiB-day", () => {
      expect(STORAGE_EUR_PER_GIB_DAY).toBeCloseTo(0.1, 12);
    });
  });

  describe("given the meter configuration", () => {
    /** @scenario The meter is additive and named to match the report command */
    it("sums the hourly event the command sends", () => {
      expect(STORAGE_METER_AGGREGATION).toBe("sum");
      expect(STORAGE_METER_EVENT_NAME).toBe(
        "langwatch_storage_megabytes_hourly",
      );
    });
  });
});
