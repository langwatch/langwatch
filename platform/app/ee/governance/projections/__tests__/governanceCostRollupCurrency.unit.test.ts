// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The rollup's side of ADR-128 §3: a day is summarized in the currency it was
 * billed in, the dollar column is stated only when someone can honestly state
 * it, and two currencies never merge into one figure.
 *
 * Driven from real events through the real fold rather than by building a
 * state by hand. The currency has to survive the trip from the event, and a
 * hand-built state proves only that the state has a field.
 *
 * Spec: specs/governance/governance-cost-rollup.feature
 * Decision: ADR-128 §3.
 */
import { describe, expect, it } from "vitest";

import { GOVERNANCE_COST_SOURCE } from "../governanceCostRollup.constants";
import {
  decodeGovernanceCostRollupKey,
  GovernanceCostRollupFoldProjection,
  type GovernanceCostRollupState,
  governanceCostRollupKey,
  governanceCostRollupTotals,
} from "../governanceCostRollup.foldProjection";

const TENANT = "proj_governance_home";
const DAY_MS = Date.parse("2026-08-23T09:30:00.000Z");

function projection() {
  return new GovernanceCostRollupFoldProjection({
    store: { store: async () => undefined, get: async () => null },
  });
}

/** One pulled observation, with the money's currency left to the caller. */
function observedEvent({
  costNanoMinor,
  currencyCode = "USD",
  costNanoUsd = null,
  restatementKey = "bucket-hash",
  observedAtMs = Date.parse("2026-08-30T09:00:00.000Z"),
  occurredAtMs = DAY_MS,
  id = `evt-${restatementKey}-${observedAtMs}`,
}: {
  costNanoMinor: number;
  currencyCode?: string;
  costNanoUsd?: number | null;
  restatementKey?: string;
  observedAtMs?: number;
  occurredAtMs?: number;
  id?: string;
}) {
  return {
    id,
    type: "lw.obs.pulled_usage.observed",
    tenantId: TENANT,
    aggregateId: restatementKey,
    occurredAt: occurredAtMs,
    data: {
      itemKey: "azure_cost:2026-08-23:Azure Databricks",
      restatementKey,
      source: "copilot_studio_dataverse",
      ingestionSourceId: "src_1",
      organizationId: "org_acme",
      teamId: null,
      projectId: TENANT,
      model: "Azure Databricks",
      tokensInput: 0,
      tokensOutput: 0,
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      costNanoMinor,
      currencyCode,
      costNanoUsd,
      rateVersion: null,
      costBasis: "provider_reported",
      costStatus: "exact",
      occurredAtMs,
      observedAtMs,
    },
  } as never;
}

function fold(events: unknown[]): GovernanceCostRollupState {
  const p = projection();
  let state = p.init();
  for (const event of events) state = p.apply(state, event as never);
  return state;
}

describe("the daily rollup and the currency a day was billed in", () => {
  describe("when the provider billed in a currency other than dollars", () => {
    /** @scenario "A pulled event in another currency is summarized under that currency" */
    it("summarizes the day under the currency the event carried", () => {
      const state = fold([
        observedEvent({ costNanoMinor: 1_533_525_880, currencyCode: "EUR" }),
      ]);

      expect(state.currencyCode).toBe("EUR");
    });

    /** @scenario "A pulled event in another currency is summarized under that currency" */
    it("addresses it under a key naming that currency, not dollars", () => {
      const key = governanceCostRollupKey(
        observedEvent({
          costNanoMinor: 1_533_525_880,
          currencyCode: "EUR",
        }) as never,
      );

      expect(decodeGovernanceCostRollupKey(key).currencyCode).toBe("EUR");
    });

    /** @scenario "A non-dollar day reports no dollar figure unless the biller gave one" */
    it("reports no dollar figure, while keeping the full billed amount", () => {
      const totals = governanceCostRollupTotals(
        fold([
          observedEvent({ costNanoMinor: 1_533_525_880, currencyCode: "EUR" }),
        ]),
      );

      expect(totals.amountNanoUsd).toBe(null);
      expect(totals.amountNanoMinor).toBe(1_533_525_880);
    });

    /** @scenario "The biller's own dollar conversion is what the dollar figure reports" */
    it("reports the biller's own dollar figure when the event carried one", () => {
      const totals = governanceCostRollupTotals(
        fold([
          observedEvent({
            costNanoMinor: 1_533_525_880,
            currencyCode: "EUR",
            costNanoUsd: 1_745_382_480,
          }),
        ]),
      );

      expect(totals.amountNanoMinor).toBe(1_533_525_880);
      expect(totals.amountNanoUsd).toBe(1_745_382_480);
    });

    /** @scenario "The biller's own dollar conversion is what the dollar figure reports" */
    it("refuses a dollar total when one contribution to the cell has no dollar figure", () => {
      const totals = governanceCostRollupTotals(
        fold([
          observedEvent({
            costNanoMinor: 1_000,
            currencyCode: "EUR",
            costNanoUsd: 1_200,
            restatementKey: "priced",
          }),
          observedEvent({
            costNanoMinor: 500,
            currencyCode: "EUR",
            restatementKey: "unpriced",
          }),
        ]),
      );

      // A partial dollar total is worse than none: it reads as the day's whole
      // spend while silently omitting the part nobody could convert.
      expect(totals.amountNanoUsd).toBe(null);
      expect(totals.amountNanoMinor).toBe(1_500);
    });
  });

  describe("when the provider billed in dollars", () => {
    /** @scenario "A non-dollar day reports no dollar figure unless the biller gave one" */
    it("states the dollar figure from the amount itself", () => {
      const totals = governanceCostRollupTotals(
        fold([observedEvent({ costNanoMinor: 2_500_000_000 })]),
      );

      expect(totals.amountNanoUsd).toBe(2_500_000_000);
      expect(totals.amountNanoMinor).toBe(2_500_000_000);
    });
  });

  describe("when one day holds two currencies", () => {
    /** @scenario "A day in two currencies keeps a separate running total for each" */
    it("keys them to separate cells so neither total mixes the two", () => {
      const inEuros = observedEvent({
        costNanoMinor: 1_000,
        currencyCode: "EUR",
        restatementKey: "eur-bucket",
      });
      const inDollars = observedEvent({
        costNanoMinor: 2_000,
        currencyCode: "USD",
        restatementKey: "usd-bucket",
      });

      expect(governanceCostRollupKey(inEuros as never)).not.toBe(
        governanceCostRollupKey(inDollars as never),
      );
      expect(governanceCostRollupTotals(fold([inEuros])).amountNanoMinor).toBe(
        1_000,
      );
      expect(
        governanceCostRollupTotals(fold([inDollars])).amountNanoMinor,
      ).toBe(2_000);
    });
  });

  describe("when a credit reverses a charge in the same currency", () => {
    /** @scenario "A credit summarizes against the charge it reverses" */
    it("totals the day to zero without dropping either figure", () => {
      const totals = governanceCostRollupTotals(
        fold([
          observedEvent({
            costNanoMinor: 1_533_525_880,
            currencyCode: "EUR",
            restatementKey: "the-charge",
          }),
          observedEvent({
            costNanoMinor: -1_533_525_880,
            currencyCode: "EUR",
            restatementKey: "the-credit",
          }),
        ]),
      );

      // Two separate items, not a restatement of one: a restatement would read
      // as zero even if credits were being dropped, which is the failure this
      // is meant to catch.
      expect(totals.amountNanoMinor).toBe(0);
      expect(totals.requestCount).toBe(2);
    });
  });

  describe("when the event predates money carrying a currency", () => {
    /** @scenario "Records already on the durable log still read after the change" */
    it("folds its amount as dollars rather than as nothing at all", () => {
      // The verbatim shape on the durable log: money under `costNanoUsd`, no
      // `costNanoMinor`, no `currencyCode`. Nothing parses these on the way
      // into the fold, so read literally the amount is `undefined` and every
      // total from here on is NaN — while the assertions still pass, because
      // Object.is says NaN equals NaN.
      const legacy = observedEvent({ costNanoMinor: 0 }) as unknown as {
        data: Record<string, unknown>;
      };
      const { costNanoMinor, currencyCode, ...rest } = legacy.data;
      const onTheLog = {
        ...legacy,
        data: { ...rest, costNanoUsd: 12_340_000_000 },
      };

      const state = fold([onTheLog]);
      const totals = governanceCostRollupTotals(state);

      expect(totals.amountNanoMinor).toBe(12_340_000_000);
      expect(totals.amountNanoUsd).toBe(12_340_000_000);
      expect(state.currencyCode).toBe("USD");
    });

    /** @scenario "Records already on the durable log still read after the change" */
    it("addresses it under the same key a stored row would carry", () => {
      const legacy = observedEvent({ costNanoMinor: 0 }) as unknown as {
        data: Record<string, unknown>;
      };
      const { costNanoMinor, currencyCode, ...rest } = legacy.data;

      // A key carrying an undefined currency would send a rebuild to a cell
      // the stored row does not occupy, and the drift watchdog would report
      // every historical cell twice.
      expect(
        decodeGovernanceCostRollupKey(
          governanceCostRollupKey({
            ...legacy,
            data: { ...rest, costNanoUsd: 1 },
          } as never),
        ).currencyCode,
      ).toBe("USD");
    });
  });

  describe("when the gateway lane contributes", () => {
    /** @scenario "A pulled event in another currency is summarized under that currency" */
    it("stays in dollars, since the gateway prices in dollars", () => {
      const state = fold([]);

      expect(state.costSource === GOVERNANCE_COST_SOURCE.PULLED).toBe(false);
      expect(governanceCostRollupTotals(state).amountNanoUsd).toBe(null);
    });
  });
});
