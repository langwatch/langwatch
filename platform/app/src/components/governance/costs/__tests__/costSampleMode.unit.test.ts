/** Determine whether real cost lanes hold figures, including withheld totals. */
import { describe, expect, it } from "vitest";

import {
  type SummaryForSampleDecision,
  summaryAsRead,
} from "../costSampleMode";

/** A headline summary in the DTO's own shape, empty unless overridden. */
function summary(
  overrides: Partial<SummaryForSampleDecision> = {},
): SummaryForSampleDecision {
  return {
    unavailableReason: null,
    billed: {
      amountUsd: null,
      cellsWithoutAmount: 0,
      currenciesWithoutUsdAmount: [],
      currencyTotals: [],
    },
    gateway: {
      amountUsd: null,
      cellsWithoutAmount: 0,
      currenciesWithoutUsdAmount: [],
      currencyTotals: [],
    },
    seats: { status: "awaiting_data" },
    ...overrides,
  };
}

describe("reading the headline summary as a real-data read", () => {
  describe("given the read has not answered", () => {
    it("stays an unanswered read", () => {
      expect(summaryAsRead(undefined)).toBeNull();
    });
  });

  describe("given the screen is structurally unavailable", () => {
    it("answers as measured and empty rather than waiting forever", () => {
      expect(
        summaryAsRead(summary({ unavailableReason: "no_cost_store" })),
      ).toEqual({ length: 0 });
    });
  });

  describe("given a pulled bill and nothing else", () => {
    it("counts a pulled bill as real data", () => {
      const read = summaryAsRead(
        summary({
          billed: {
            amountUsd: 123.45,
            cellsWithoutAmount: 0,
            currenciesWithoutUsdAmount: [],
            currencyTotals: [
              { currencyCode: "USD", amount: 123.45, cellsWithoutAmount: 0 },
            ],
          },
        }),
      );
      expect(read?.length).toBeGreaterThan(0);
    });
  });

  describe("given a bill whose total is withheld for currency", () => {
    it("still counts as real data — withheld is not absent", () => {
      const read = summaryAsRead(
        summary({
          billed: {
            amountUsd: null,
            cellsWithoutAmount: 4,
            currenciesWithoutUsdAmount: ["EUR"],
            currencyTotals: [
              { currencyCode: "USD", amount: null, cellsWithoutAmount: 4 },
            ],
          },
        }),
      );
      expect(read?.length).toBeGreaterThan(0);
    });
  });

  describe("given seat pools and no money", () => {
    it("counts as real data", () => {
      const read = summaryAsRead(
        summary({
          seats: {
            status: "reported",
            pools: [
              {
                skuPartNumber: "VIRTUAL_AGENT_USL",
                day: "2026-08-01",
                seatsBought: 5,
                seatsAssigned: 3,
              },
            ],
          },
        }),
      );
      expect(read?.length).toBeGreaterThan(0);
    });
  });

  describe("given every lane answered with nothing", () => {
    it("reads as measured and empty", () => {
      expect(summaryAsRead(summary())).toEqual({ length: 0 });
    });
  });
});
