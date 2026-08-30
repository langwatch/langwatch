// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Turning the Azure bill into events, and deciding what the next run asks for
 * when this one could not read it.
 *
 * The two rules that matter most are both about NOT writing a number. A day
 * Azure returned no row for must produce no event at all, because a zero would
 * be honoured as a correction downward over a figure already recorded. And a
 * throttled read must hold the window rather than price it at nothing, because
 * being asked to retry says nothing about what the window costs.
 *
 * Spec: specs/ai-governance/puller-framework/copilot-studio-dataverse.feature
 * Decision: ADR-128 §3.
 */
import { describe, expect, it } from "vitest";

import {
  AZURE_COST_MAX_HOLD_MS,
  type AzureDailyCost,
  azureCostEvents,
  nextAzureCostCursor,
} from "../azureCostManagement";
import { PULLED_USAGE_HINT_KEY } from "../pulledUsageRecord";

const SUBSCRIPTION_ID = "00000000-0000-0000-0000-000000000000";
const NOW_MS = Date.parse("2026-08-30T09:00:00.000Z");

function day(overrides: Partial<AzureDailyCost> = {}): AzureDailyCost {
  return {
    day: "2026-08-23",
    meterCategory: "Load Balancer",
    costMinor: "0.527171286737249",
    costUsd: "0.6",
    currencyCode: "EUR",
    ...overrides,
  };
}

function eventsFor(days: AzureDailyCost[]) {
  return azureCostEvents({ days, subscriptionId: SUBSCRIPTION_ID });
}

describe("the events one Azure cost read produces", () => {
  describe("when Azure returned a day's bill", () => {
    /** @scenario "The daily bill is read as the currency the customer is billed in" */
    it("carries the billed amount, its currency and Microsoft's dollar figure", () => {
      const [event] = eventsFor([day()]);
      const hint = event?.extra?.[PULLED_USAGE_HINT_KEY] as Record<
        string,
        unknown
      >;

      expect(hint.costUsd).toBe("0.527171286737249");
      expect(hint.currency).toBe("EUR");
      expect(hint.costUsdBiller).toBe("0.6");
      expect(hint.costBasis).toBe("provider_reported");
      // The bill IS the invoice, unlike a usage report that approximates one.
      expect(hint.costStatus).toBe("exact");
    });

    /** @scenario "The daily bill is read as the currency the customer is billed in" */
    it("dates the event to the business day, not to the moment it was read", () => {
      const [event] = eventsFor([day()]);

      expect(event?.event_timestamp).toBe("2026-08-23T00:00:00.000Z");
    });

    /** @scenario "The daily bill is read as the currency the customer is billed in" */
    it("names no person, because a subscription bill names none", () => {
      const [event] = eventsFor([day()]);

      expect(event?.actor).toBe("");
    });
  });

  describe("when the same day and meter are read on two different runs", () => {
    /** @scenario "A day already recorded is re-read and its figure replaced, not added to" */
    it("produces the same identity both times, so the later figure replaces", () => {
      const whileRunning = eventsFor([day({ costMinor: "0.329482054210781" })]);
      const onceFinished = eventsFor([day({ costMinor: "0.527171286737249" })]);

      // Same event id and same dimensions means the same restatement key,
      // which is what makes the finished figure land ON the partial one
      // rather than beside it and double the day.
      expect(onceFinished[0]?.source_event_id).toBe(
        whileRunning[0]?.source_event_id,
      );
      const before = whileRunning[0]?.extra?.[PULLED_USAGE_HINT_KEY] as Record<
        string,
        unknown
      >;
      const after = onceFinished[0]?.extra?.[PULLED_USAGE_HINT_KEY] as Record<
        string,
        unknown
      >;
      expect(after.dimensions).toEqual(before.dimensions);
      // The money is NOT among the dimensions, or a correction would mint a
      // fresh key and be added on top of the figure it corrects.
      expect(
        JSON.stringify(after.dimensions).includes("0.527171286737249"),
      ).toBe(false);
    });

    /** @scenario "A day already recorded is re-read and its figure replaced, not added to" */
    it("keeps two meter categories on one day apart", () => {
      const [first, second] = eventsFor([
        day({ meterCategory: "Load Balancer" }),
        day({ meterCategory: "Foundry Models" }),
      ]);

      expect(first?.source_event_id).not.toBe(second?.source_event_id);
    });
  });

  describe("when Azure returned no row for a day", () => {
    /** @scenario "A re-read day the bill has not landed for emits no figure at all" */
    it("emits nothing for it rather than a zero", () => {
      // The absence has to survive as an absence all the way out: a zero
      // emitted for a day already recorded at a real figure is a correction
      // downward to nothing, and the summarizing step would honour it.
      expect(eventsFor([])).toEqual([]);
    });
  });

  describe("when a day is a credit rather than a charge", () => {
    /** @scenario "A refunded day is recorded as the credit the provider reported" */
    it("carries the negative figure through unchanged", () => {
      const [event] = eventsFor([
        day({ costMinor: "-0.527171286737249", costUsd: "-0.6" }),
      ]);
      const hint = event?.extra?.[PULLED_USAGE_HINT_KEY] as Record<
        string,
        unknown
      >;

      expect(hint.costUsd).toBe("-0.527171286737249");
      expect(hint.costUsdBiller).toBe("-0.6");
    });
  });

  describe("when the subscription is billed in dollars", () => {
    /** @scenario "The daily bill is read as the currency the customer is billed in" */
    it("carries no separate biller conversion, since the amount is already one", () => {
      const [event] = eventsFor([
        day({ currencyCode: "USD", costMinor: "0.6", costUsd: null }),
      ]);
      const hint = event?.extra?.[PULLED_USAGE_HINT_KEY] as Record<
        string,
        unknown
      >;

      expect(hint.currency).toBe("USD");
      expect(hint.costUsdBiller).toBeUndefined();
    });
  });
});

describe("what the next run asks for", () => {
  describe("when this run priced the window", () => {
    /** @scenario "A day already recorded is re-read and its figure replaced, not added to" */
    it("records how far cost is priced and clears any hold", () => {
      const next = nextAzureCostCursor({
        nowMs: NOW_MS,
        previous: {
          pricedThroughDay: "2026-08-20",
          heldSinceMs: NOW_MS - 1000,
        },
        outcome: "priced",
      });

      expect(next).toEqual({
        pricedThroughDay: "2026-08-30",
        heldSinceMs: null,
      });
    });
  });

  describe("when this run was told to retry later", () => {
    /** @scenario "Being asked to slow down leaves the window unpriced rather than priced at nothing" */
    it("leaves the priced-through point where it was and starts a hold", () => {
      const next = nextAzureCostCursor({
        nowMs: NOW_MS,
        previous: { pricedThroughDay: "2026-08-20", heldSinceMs: null },
        outcome: "held",
      });

      expect(next.pricedThroughDay).toBe("2026-08-20");
      expect(next.heldSinceMs).toBe(NOW_MS);
    });

    /** @scenario "The very first cost read ever being throttled leaves nothing behind" */
    it("leaves nothing priced when it has never read cost before", () => {
      const next = nextAzureCostCursor({
        nowMs: NOW_MS,
        previous: { pricedThroughDay: null, heldSinceMs: null },
        outcome: "held",
      });

      // This is not the hypothetical case: it is what happened on the first
      // real request against a live subscription.
      expect(next.pricedThroughDay).toBe(null);
      expect(next.heldSinceMs).toBe(NOW_MS);
    });

    /** @scenario "A held window is asked about again on the next run" */
    it("keeps the original hold instant across repeated failures", () => {
      const startedAt = NOW_MS - 60_000;
      const next = nextAzureCostCursor({
        nowMs: NOW_MS,
        previous: { pricedThroughDay: "2026-08-20", heldSinceMs: startedAt },
        outcome: "held",
      });

      // Refreshing it on every failure would make the cap unreachable, so a
      // window that can never be read would hold the source forever.
      expect(next.heldSinceMs).toBe(startedAt);
    });
  });

  describe("when the window has been held past the cap", () => {
    /** @scenario "A window held for too long is given up rather than held forever" */
    it("gives up on it and stops the ask widening every run", () => {
      const next = nextAzureCostCursor({
        nowMs: NOW_MS,
        previous: {
          pricedThroughDay: "2026-07-01",
          heldSinceMs: NOW_MS - AZURE_COST_MAX_HOLD_MS - 1,
        },
        outcome: "held",
      });

      expect(next.heldSinceMs).toBe(null);
      // Back to the trailing week: the day before the window's own start, so
      // the next run asks about the last seven days and no more.
      expect(next.pricedThroughDay).toBe("2026-08-23");
    });
  });
});
