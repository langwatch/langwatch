// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The connected view's arithmetic (ADR-128 §2, §7).
 *
 * The scenarios these bind to are parked `@unimplemented`, so the parity gate
 * does not count them, and that is deliberate rather than an oversight: each one
 * describes what a reader is SHOWN, and nothing draws these numbers yet. The
 * arithmetic is real and this file proves it; the view is the part that is
 * missing. Binding without parking would report a screen as delivered on the
 * strength of tests that render nothing.
 *
 * Spec: specs/governance/governance-cost-coverage.feature
 */
import { describe, expect, it } from "vitest";

import {
  COVERAGE_INELIGIBLE,
  type CurrencyAmount,
  combineProviderDay,
} from "../combinedCostLanes";

/** One dollar in nano-units. */
const DOLLAR = 1_000_000_000n;
const usd = (dollars: number): CurrencyAmount => ({
  amountNano: (BigInt(Math.round(dollars * 100)) * DOLLAR) / 100n,
  currencyCode: "USD",
});
const eur = (dollars: number): CurrencyAmount => ({
  ...usd(dollars),
  currencyCode: "EUR",
});

const lanes = (overrides: {
  bill?: CurrencyAmount | null;
  coveredGateway?: CurrencyAmount | null;
  unmappedGateway?: CurrencyAmount | null;
}) => ({
  day: "2026-06-01",
  provider: "anthropic",
  bill: overrides.bill ?? null,
  coveredGateway: overrides.coveredGateway ?? null,
  unmappedGateway: overrides.unmappedGateway ?? null,
});

describe("Feature: the total shown is the bill, and gateway detail splits it", () => {
  describe("given a bill and gateway spend on the keys it covers", () => {
    /** @scenario "Gateway detail splits the bill and the remainder is its own line" */
    it("shows the bill as the total and names the part nothing explains", () => {
      const combined = combineProviderDay(
        lanes({ bill: usd(6), coveredGateway: usd(4.2) }),
      );

      expect(combined.total).toEqual({ ...usd(6), basis: "billed" });
      expect(combined.split?.attributedNano).toBe(usd(4.2).amountNano);
      expect(combined.split?.unallocatedNano).toBe(usd(1.8).amountNano);
      expect(combined.split?.overMeteredNano).toBe(0n);
    });
  });

  describe("when metering ran above the bill", () => {
    /** @scenario "Gateway spend above the bill is shown as a variance, never subtracted" */
    it("keeps the bill as the total and reports the overrun beside it", () => {
      const combined = combineProviderDay(
        lanes({ bill: usd(6), coveredGateway: usd(6.5) }),
      );

      expect(combined.total?.amountNano).toBe(usd(6).amountNano);
      expect(combined.split?.overMeteredNano).toBe(usd(0.5).amountNano);
      // Nothing is taken off the total, and the attributed part cannot exceed
      // it: the overrun is a comparison, not a component.
      expect(combined.split?.attributedNano).toBe(usd(6).amountNano);
      expect(combined.split?.unallocatedNano).toBe(0n);
    });
  });

  describe("given a provider day whose bill is a refund", () => {
    /** @scenario "A refunded day stays negative" */
    it("renders the negative figure as it is", () => {
      const refund = { amountNano: -3n * DOLLAR, currencyCode: "USD" };

      const combined = combineProviderDay(
        lanes({ bill: refund, coveredGateway: usd(5) }),
      );

      expect(combined.total?.amountNano).toBe(-3n * DOLLAR);
      // Metering cannot account for a refund, so none of it is attributed and
      // the whole negative figure is the unallocated line.
      expect(combined.split?.attributedNano).toBe(0n);
      expect(combined.split?.unallocatedNano).toBe(-3n * DOLLAR);
      expect(combined.split?.overMeteredNano).toBe(8n * DOLLAR);
    });
  });

  describe("given a day no bill has reported yet", () => {
    /** @scenario "A day the bill has not reached yet is marked estimated" */
    it("stands the gateway figure in and says it is an estimate", () => {
      const combined = combineProviderDay(
        lanes({ bill: null, coveredGateway: usd(4.2) }),
      );

      expect(combined.total).toEqual({ ...usd(4.2), basis: "estimated" });
      expect(combined.split?.attributedNano).toBe(usd(4.2).amountNano);
      expect(combined.split?.unallocatedNano).toBe(0n);
    });

    /** @scenario "The estimate becomes the bill when the bill lands" */
    it("flips to the bill and drops the estimate mark once the bill arrives", () => {
      const before = combineProviderDay(
        lanes({ bill: null, coveredGateway: usd(4.2) }),
      );
      const after = combineProviderDay(
        lanes({ bill: usd(6), coveredGateway: usd(4.2) }),
      );

      expect(before.total?.basis).toBe("estimated");
      expect(after.total?.basis).toBe("billed");
      expect(after.total?.amountNano).toBe(usd(6).amountNano);
    });
  });

  describe("given gateway spend on a key no bill covers", () => {
    /** @scenario "Gateway spend no bill covers stands alone" */
    it("reports it on its own and counts it against no bill", () => {
      const combined = combineProviderDay(
        lanes({ bill: usd(6), coveredGateway: null, unmappedGateway: usd(2) }),
      );

      expect(combined.metered).toEqual(usd(2));
      expect(combined.split?.attributedNano).toBe(0n);
      expect(combined.split?.unallocatedNano).toBe(usd(6).amountNano);
    });
  });

  describe("when the bill and its keys are priced in different currencies", () => {
    /** @scenario "A bill and its keys in different currencies are not combined" */
    it("reports both lanes in their own currency and shows no split", () => {
      const combined = combineProviderDay(
        lanes({
          bill: eur(6),
          coveredGateway: usd(4.2),
          unmappedGateway: usd(1),
        }),
      );

      expect(combined.total).toEqual({ ...eur(6), basis: "billed" });
      expect(combined.split).toBeNull();
      expect(combined.ineligibleReason).toBe(
        COVERAGE_INELIGIBLE.CROSS_CURRENCY,
      );
      // The covered metering does not vanish because it could not be matched:
      // its dollars are real, so it joins the lane that stands alone.
      expect(combined.metered).toEqual(usd(5.2));
    });
  });

  describe("given any provider day with a bill", () => {
    /** @scenario "The parts of a day always add up to its total" */
    it("keeps the attributed part and the unallocated part summing to the total", () => {
      const bills = [usd(6), usd(0), { amountNano: -3n, currencyCode: "USD" }];
      const metering = [null, usd(0), usd(4.2), usd(6.5), usd(100)];

      for (const bill of bills) {
        for (const coveredGateway of metering) {
          const combined = combineProviderDay(lanes({ bill, coveredGateway }));

          expect(combined.split).not.toBeNull();
          expect(
            combined.split!.attributedNano + combined.split!.unallocatedNano,
          ).toBe(bill.amountNano);
          expect(combined.split!.attributedNano >= 0n).toBe(true);
          expect(combined.split!.overMeteredNano >= 0n).toBe(true);
        }
      }
    });
  });

  describe("given a day neither lane said anything about", () => {
    it("states no total rather than zero", () => {
      const combined = combineProviderDay(lanes({}));

      expect(combined.total).toBeNull();
      expect(combined.split).toBeNull();
      expect(combined.metered).toBeNull();
    });
  });
});
