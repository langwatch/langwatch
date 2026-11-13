/**
 * The least a billed seat line may be lowered to, per seat kind.
 * @see specs/licensing/seat-quantity-floor.feature
 */
import { BILLED_SEAT_KINDS, STRIPE_PRICE_NAMES } from "@langwatch/enterprise-billing-contract";
import { describe, expect, it } from "vitest";

import { assertSeatsCoverUse, SEAT_FLOORS } from "../seat-floor.rules.ts";

describe("assertSeatsCoverUse", () => {
  describe("given full seats", () => {
    it("lets a count at the seats in use through", () => {
      expect(() => assertSeatsCoverUse({ seat: "full", requested: 5, inUse: 5 })).not.toThrow();
    });

    it("refuses a count below the seats in use, naming the seat kind", () => {
      expect(() => assertSeatsCoverUse({ seat: "full", requested: 3, inUse: 5 })).toThrow(
        expect.objectContaining({
          code: "seat_quantity_below_in_use",
          meta: { seat: "full", requested: 3, minimum: 5 },
        }),
      );
    });

    it("keeps one seat when none is in use", () => {
      expect(() => assertSeatsCoverUse({ seat: "full", requested: 0, inUse: 0 })).toThrow(
        expect.objectContaining({ meta: { seat: "full", requested: 0, minimum: 1 } }),
      );
    });
  });

  describe("given Developer seats", () => {
    it("lets a count at the Developers in use through", () => {
      expect(() =>
        assertSeatsCoverUse({ seat: "developer", requested: 2, inUse: 2 }),
      ).not.toThrow();
    });

    it("refuses a count below the Developers in use", () => {
      expect(() => assertSeatsCoverUse({ seat: "developer", requested: 1, inUse: 2 })).toThrow(
        expect.objectContaining({
          code: "seat_quantity_below_in_use",
          meta: { seat: "developer", requested: 1, minimum: 2 },
        }),
      );
    });

    it("lets the line go to zero when no Developer is in use", () => {
      expect(() =>
        assertSeatsCoverUse({ seat: "developer", requested: 0, inUse: 0 }),
      ).not.toThrow();
    });
  });
});

describe("SEAT_FLOORS", () => {
  /** @scenario "Every seat price in the catalogue belongs to a seat kind with a floor" */
  it("covers every seat price family in the catalogue", () => {
    const prefixes = BILLED_SEAT_KINDS.map((seat) => SEAT_FLOORS[seat].pricePrefix);
    const seatPrices = STRIPE_PRICE_NAMES.filter((name) => name.includes("_SEAT_"));

    expect(seatPrices.length).toBeGreaterThan(0);
    const unfloored = seatPrices.filter(
      (name) => !prefixes.some((prefix) => name.startsWith(prefix)),
    );
    expect(unfloored).toEqual([]);
  });
});
