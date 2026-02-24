import { describe, expect, it, vi } from "vitest";

vi.mock("../stripe/stripePriceCatalog", () => ({
  prices: {
    GROWTH_SEAT_EUR_MONTHLY: "price_seat_eur_monthly",
    GROWTH_SEAT_EUR_ANNUAL: "price_seat_eur_annual",
    GROWTH_SEAT_USD_MONTHLY: "price_seat_usd_monthly",
    GROWTH_SEAT_USD_ANNUAL: "price_seat_usd_annual",
    GROWTH_EVENTS_EUR_MONTHLY: "price_events_eur_monthly",
    GROWTH_EVENTS_EUR_ANNUAL: "price_events_eur_annual",
    GROWTH_EVENTS_USD_MONTHLY: "price_events_usd_monthly",
    GROWTH_EVENTS_USD_ANNUAL: "price_events_usd_annual",
  },
}));

import {
  isGrowthSeatPrice,
  isGrowthEventsPrice,
  resolveGrowthSeatPriceId,
  resolveGrowthEventsPriceId,
  createCheckoutLineItems,
} from "../utils/growthSeatEvent";

describe("growthSeatEvent", () => {
  describe("isGrowthSeatPrice()", () => {
    describe("when given a growth seat price ID", () => {
      it("returns true for EUR monthly", () => {
        expect(isGrowthSeatPrice("price_seat_eur_monthly")).toBe(true);
      });

      it("returns true for EUR annual", () => {
        expect(isGrowthSeatPrice("price_seat_eur_annual")).toBe(true);
      });

      it("returns true for USD monthly", () => {
        expect(isGrowthSeatPrice("price_seat_usd_monthly")).toBe(true);
      });

      it("returns true for USD annual", () => {
        expect(isGrowthSeatPrice("price_seat_usd_annual")).toBe(true);
      });
    });

    describe("when given a non-seat price ID", () => {
      it("returns false for an events price", () => {
        expect(isGrowthSeatPrice("price_events_eur_monthly")).toBe(false);
      });

      it("returns false for an unknown price", () => {
        expect(isGrowthSeatPrice("price_unknown")).toBe(false);
      });
    });
  });

  describe("isGrowthEventsPrice()", () => {
    describe("when given a growth events price ID", () => {
      it("returns true for EUR monthly", () => {
        expect(isGrowthEventsPrice("price_events_eur_monthly")).toBe(true);
      });

      it("returns true for EUR annual", () => {
        expect(isGrowthEventsPrice("price_events_eur_annual")).toBe(true);
      });

      it("returns true for USD monthly", () => {
        expect(isGrowthEventsPrice("price_events_usd_monthly")).toBe(true);
      });

      it("returns true for USD annual", () => {
        expect(isGrowthEventsPrice("price_events_usd_annual")).toBe(true);
      });
    });

    describe("when given a non-events price ID", () => {
      it("returns false for a seat price", () => {
        expect(isGrowthEventsPrice("price_seat_eur_monthly")).toBe(false);
      });

      it("returns false for an unknown price", () => {
        expect(isGrowthEventsPrice("price_unknown")).toBe(false);
      });
    });
  });

  describe("resolveGrowthSeatPriceId()", () => {
    describe("when resolving EUR prices", () => {
      it("returns the monthly EUR seat price", () => {
        expect(resolveGrowthSeatPriceId({ currency: "EUR", interval: "monthly" })).toBe(
          "price_seat_eur_monthly",
        );
      });

      it("returns the annual EUR seat price", () => {
        expect(resolveGrowthSeatPriceId({ currency: "EUR", interval: "annual" })).toBe(
          "price_seat_eur_annual",
        );
      });
    });

    describe("when resolving USD prices", () => {
      it("returns the monthly USD seat price", () => {
        expect(resolveGrowthSeatPriceId({ currency: "USD", interval: "monthly" })).toBe(
          "price_seat_usd_monthly",
        );
      });

      it("returns the annual USD seat price", () => {
        expect(resolveGrowthSeatPriceId({ currency: "USD", interval: "annual" })).toBe(
          "price_seat_usd_annual",
        );
      });
    });
  });

  describe("resolveGrowthEventsPriceId()", () => {
    describe("when resolving EUR prices", () => {
      it("returns the monthly EUR events price", () => {
        expect(resolveGrowthEventsPriceId({ currency: "EUR", interval: "monthly" })).toBe(
          "price_events_eur_monthly",
        );
      });

      it("returns the annual EUR events price", () => {
        expect(resolveGrowthEventsPriceId({ currency: "EUR", interval: "annual" })).toBe(
          "price_events_eur_annual",
        );
      });
    });

    describe("when resolving USD prices", () => {
      it("returns the monthly USD events price", () => {
        expect(resolveGrowthEventsPriceId({ currency: "USD", interval: "monthly" })).toBe(
          "price_events_usd_monthly",
        );
      });

      it("returns the annual USD events price", () => {
        expect(resolveGrowthEventsPriceId({ currency: "USD", interval: "annual" })).toBe(
          "price_events_usd_annual",
        );
      });
    });
  });

  describe("createCheckoutLineItems()", () => {
    describe("when creating line items for EUR monthly", () => {
      it("returns seat and events line items with correct quantities", () => {
        const items = createCheckoutLineItems({
          coreMembers: 5,
          currency: "EUR",
          interval: "monthly",
        });

        expect(items).toEqual([
          { price: "price_seat_eur_monthly", quantity: 5 },
          { price: "price_events_eur_monthly" },
        ]);
      });
    });

    describe("when creating line items for USD annual", () => {
      it("returns seat and events line items with correct quantities", () => {
        const items = createCheckoutLineItems({
          coreMembers: 3,
          currency: "USD",
          interval: "annual",
        });

        expect(items).toEqual([
          { price: "price_seat_usd_annual", quantity: 3 },
          { price: "price_events_usd_annual" },
        ]);
      });
    });

    describe("when creating line items with a single member", () => {
      it("returns seat quantity of 1", () => {
        const items = createCheckoutLineItems({
          coreMembers: 1,
          currency: "EUR",
          interval: "annual",
        });

        expect(items).toEqual([
          { price: "price_seat_eur_annual", quantity: 1 },
          { price: "price_events_eur_annual" },
        ]);
      });
    });
  });
});
