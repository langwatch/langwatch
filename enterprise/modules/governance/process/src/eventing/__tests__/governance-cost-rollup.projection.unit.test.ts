// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Port of main's governanceCostRollup fold tests. Specs: governance-cost-rollup.feature, governance-cost-restatement-markers.feature */
import { describe, expect, it } from "vitest";

import { governanceCostRollupTotals } from "../../rules/governance-cost-rollup-cell.rules.ts";
import {
  DAY_START_MS,
  HOUR_MS,
  observed,
  retracted,
  rollupFold,
} from "./governance-cost-rollup.fixtures.ts";

const T1 = DAY_START_MS + HOUR_MS;
const T2 = DAY_START_MS + 5 * HOUR_MS;

describe("the daily rollup and the currency a day was billed in", () => {
  describe("when the provider billed in a currency other than dollars", () => {
    /** @scenario "A pulled event in another currency is summarized under that currency" */
    it("summarizes the day under that currency, keyed apart from dollars", () => {
      const { projection, fold } = rollupFold();
      const euro = observed({ restatementKey: "item-a", currencyCode: "EUR" });

      expect(fold([euro]).currencyCode).toBe("EUR");
      expect(projection.key(euro)).not.toBe(projection.key(observed({ restatementKey: "item-a" })));
    });

    /** @scenario "A non-dollar day reports no dollar figure unless the biller gave one" */
    it("reports no dollar figure, while keeping the full billed amount", () => {
      const { fold } = rollupFold();

      const totals = governanceCostRollupTotals(
        fold([observed({ restatementKey: "item-a", currencyCode: "EUR", costNanoMinor: 7_000 })]),
      );

      expect(totals).toMatchObject({ amountNanoUsd: null, amountNanoMinor: 7_000 });
    });

    /** @scenario "The biller's own dollar conversion is what the dollar figure reports" */
    it("reports the biller's figure, and refuses a total when one item has none", () => {
      const { fold } = rollupFold();
      const converted = observed({ restatementKey: "a", currencyCode: "EUR", costNanoUsd: 1_100 });
      const unconverted = observed({ restatementKey: "b", currencyCode: "EUR" });

      expect(governanceCostRollupTotals(fold([converted])).amountNanoUsd).toBe(1_100);
      expect(governanceCostRollupTotals(fold([converted, unconverted])).amountNanoUsd).toBeNull();
    });
  });

  describe("when the provider billed in dollars", () => {
    /** @scenario "A non-dollar day reports no dollar figure unless the biller gave one" */
    it("states the dollar figure from the amount itself", () => {
      const { fold } = rollupFold();

      const totals = governanceCostRollupTotals(fold([observed({ restatementKey: "a" })]));

      expect(totals.amountNanoUsd).toBe(1_000);
    });
  });

  describe("when one day holds two currencies", () => {
    /** @scenario "A day in two currencies keeps a separate running total for each" */
    it("keys them to separate cells so neither total mixes the two", () => {
      const { projection } = rollupFold();

      const dollars = projection.key(observed({ restatementKey: "a", currencyCode: "USD" }));
      const euros = projection.key(observed({ restatementKey: "b", currencyCode: "EUR" }));

      expect(dollars).not.toBe(euros);
    });
  });

  describe("when a credit reverses a charge in the same currency", () => {
    /** @scenario "A credit summarizes against the charge it reverses" */
    it("totals the day to zero without dropping either figure", () => {
      const { fold } = rollupFold();

      const totals = governanceCostRollupTotals(
        fold([
          observed({ restatementKey: "charge", costNanoMinor: 500 }),
          observed({ restatementKey: "credit", costNanoMinor: -500 }),
        ]),
      );

      expect(totals).toMatchObject({ amountNanoMinor: 0, requestCount: 2 });
    });
  });
});

describe("the restatement marker", () => {
  describe("when one pull revises two items in the same cell", () => {
    /** @scenario "One pull revising several items preserves the previous whole-cell total" */
    it("names the whole cell's total before that pull", () => {
      const { fold } = rollupFold();

      const state = fold([
        observed({ restatementKey: "a", costNanoMinor: 100, observedAtMs: T1 }),
        observed({ restatementKey: "b", costNanoMinor: 200, observedAtMs: T1 }),
        observed({ restatementKey: "a", costNanoMinor: 150, observedAtMs: T2 }),
        observed({ restatementKey: "b", costNanoMinor: 250, observedAtMs: T2 }),
      ]);

      expect(state).toMatchObject({ previousAmountNanoUsd: 300, revisedAt: T2 });
    });
  });

  describe("given the provider restates a day at a different amount", () => {
    /** @scenario "A restated day shows what it was before" */
    it("names the amount the day held before, and when the change was seen", () => {
      const { fold } = rollupFold();

      const state = fold([
        observed({ restatementKey: "a", costNanoMinor: 100, observedAtMs: T1 }),
        observed({ restatementKey: "a", costNanoMinor: 150, observedAtMs: T2 }),
      ]);

      expect(state).toMatchObject({ previousAmountNanoUsd: 100, revisedAt: T2, revisionCount: 1 });
    });
  });

  describe("given a later pull reports the same day at the same amount", () => {
    /** @scenario "A re-pull that confirms the same amount is not a revision" */
    it("does not call the confirmation a revision", () => {
      const { fold } = rollupFold();

      const state = fold([
        observed({ restatementKey: "a", observedAtMs: T1 }),
        observed({ restatementKey: "a", observedAtMs: T2 }),
      ]);

      expect(state).toMatchObject({
        revisionCount: 0,
        revisedAt: null,
        previousAmountNanoUsd: null,
      });
    });

    /** @scenario "A re-pull that confirms the same amount still refreshes the day" */
    it("moves the last-observed anchor to the confirming pull", () => {
      const { fold } = rollupFold();

      const state = fold([
        observed({ restatementKey: "a", observedAtMs: T1 }),
        observed({ restatementKey: "a", observedAtMs: T2 }),
      ]);

      expect(state.lastObservedAt).toBe(T2);
    });
  });
});

describe("the last-observed anchor", () => {
  describe("given an older observation of another item arrives last", () => {
    /** @scenario "Rebuilding after a stale observation is redelivered keeps the newer time" */
    it("keeps the newest pull rather than the last-delivered one", () => {
      const { fold } = rollupFold();

      const state = fold([
        observed({ restatementKey: "a", observedAtMs: T2 }),
        observed({ restatementKey: "b", observedAtMs: T1 }),
      ]);

      expect(state.lastObservedAt).toBe(T2);
    });
  });

  describe("given the same events are replayed", () => {
    /** @scenario "Replaying the event log reproduces when each day was last observed" */
    it("reproduces the anchor and the markers in any order", () => {
      const { fold } = rollupFold();
      const events = [
        observed({ restatementKey: "a", costNanoMinor: 100, observedAtMs: T1 }),
        observed({ restatementKey: "a", costNanoMinor: 150, observedAtMs: T2 }),
        observed({ restatementKey: "b", costNanoMinor: 40, observedAtMs: T1 }),
      ];
      const pick = (events_: typeof events) => {
        const { lastObservedAt, revisedAt, previousAmountNanoUsd, pulledItems } = fold(events_);
        return { lastObservedAt, revisedAt, previousAmountNanoUsd, pulledItems };
      };

      expect(pick([...events].reverse())).toEqual(pick(events));
    });
  });
});

describe("a retraction", () => {
  it("zeroes the item it names and counts as a revision of the cell", () => {
    const { fold } = rollupFold();

    const state = fold([
      observed({ restatementKey: "a", costNanoMinor: 900, observedAtMs: T1 }),
      retracted({ restatementKey: "a", observedAtMs: T2 }),
    ]);

    expect(governanceCostRollupTotals(state)).toMatchObject({ amountNanoUsd: 0, requestCount: 1 });
    expect(state).toMatchObject({ revisionCount: 1, previousAmountNanoUsd: 900, revisedAt: T2 });
  });

  it("addresses an erased spender under the stand-in, never the original", () => {
    const { projection } = rollupFold({ pseudonyms: new Map([["ada@corp", "digest-1"]]) });

    const cell = projection.cellOf(
      retracted({ restatementKey: "a", observedAtMs: T2, rawActorId: "ada@corp" }),
    );

    expect(cell.rawActorId).toBe("digest-1");
  });
});

describe("the fold through storage", () => {
  it("writes the cell the cost reads answer from, and reads it back unchanged", async () => {
    const { projection, repository, fold } = rollupFold();
    const event = observed({ restatementKey: "a", costNanoMinor: 2_000 });
    const state = { ...fold([event]), createdAt: 1, updatedAt: 2, LastEventOccurredAt: 3 };
    const context = { aggregateId: "a", tenantId: event.tenantId, key: projection.key(event) };

    await projection.store.store(state, context);

    await expect(projection.store.get("a", context)).resolves.toEqual({
      kind: "folded",
      state: { ...state, lastObservedAt: Math.floor(state.lastObservedAt / 1000) * 1000 },
    });
    await expect(
      repository.sumDaysByProvider({
        tenantId: event.tenantId,
        fromDay: "2026-09-01",
        toDay: "2026-09-01",
      }),
    ).resolves.toMatchObject([{ day: "2026-09-01", provider: "openai", amountNanoUsd: 2_000 }]);
  });
});
