// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Main's `GovernanceCostService.summary` money lanes over the memory twins. @see specs/governance/governance-cost-screen.feature */
import { describe, expect, it } from "vitest";

import { cell, gatewayDay, setup } from "./governance-cost-summary.fixtures.ts";

const EUR = { currencyCode: "EUR", amountNanoUsd: null, amountNanoMinor: 5_000_000_000 };

describe("GovernanceCostSummaryService.summary", () => {
  describe("given an organization that has never ingested anything", () => {
    it("reports unavailable with null amounts rather than zeros", async () => {
      const summary = await setup({ governed: false }).read();

      expect(summary.unavailableReason).toBe("no_governance_project");
      expect(summary.billed.amountUsd).toBeNull();
      expect(summary.gateway.amountUsd).toBeNull();
      expect(summary.seats).toEqual({ status: "awaiting_data" });
      expect(summary.series).toEqual([]);
    });
  });

  describe("given corrected cells from two providers", () => {
    /** @scenario "Provider totals use corrected rollup cells within the selected window" */
    it("keeps the billed headline and the provider figures on the same read", async () => {
      const { costRollup, read } = setup();
      costRollup.seed(cell({ amountNanoUsd: 9_000_000_000, amountNanoMinor: 9_000_000_000 }));
      costRollup.seed(cell({ amountNanoUsd: 2_000_000_000, amountNanoMinor: 2_000_000_000 }));
      costRollup.seed(
        cell({ provider: "anthropic", amountNanoUsd: 500_000_000, amountNanoMinor: 500_000_000 }),
      );
      costRollup.seed(cell({ day: "2026-08-01", amountNanoUsd: 7_000_000_000 }));

      const summary = await read();

      expect(summary.billed.amountUsd).toBe(2.5);
      expect(summary.providers.map((p) => [p.provider, p.amountUsd])).toEqual([
        ["anthropic", 0.5],
        ["openai", 2],
      ]);
      expect(summary.billed.currencyTotals).toEqual([
        { currencyCode: "USD", amount: 2.5, cellsWithoutAmount: 0 },
      ]);
    });
  });

  describe("given a lane mixing dollar usage with usage billed elsewhere", () => {
    /** @scenario "A lane with usage we cannot state in US dollars holds no total" */
    /** @scenario "A currency total is withheld when part of what it covers holds no amount" */
    it("withholds the dollar figure over an unpriced cell and totals the euros on their own line", async () => {
      const { costRollup, read } = setup();
      costRollup.seed(cell({}));
      costRollup.seed(cell({ model: "gpt-5-mini", ...EUR }));
      costRollup.seed(cell({ model: "o3", amountNanoUsd: null, amountNanoMinor: 0 }));

      const summary = await read();

      expect(summary.billed.amountUsd).toBeNull();
      expect(summary.billed.cellsWithoutAmount).toBe(1);
      expect(summary.billed.currenciesWithoutUsdAmount).toEqual(["EUR"]);
      expect(summary.billed.currencyTotals).toEqual([
        { currencyCode: "EUR", amount: 5, cellsWithoutAmount: 0 },
        { currencyCode: "USD", amount: null, cellsWithoutAmount: 1 },
      ]);
    });

    /** @scenario "A day mixing stated and unstated amounts holds no figure for that lane" */
    it("gaps the day over an amount it holds none of, keeps it over priced euros, and says what it leaves out", async () => {
      const { costRollup, read } = setup();
      costRollup.seed(cell({ day: "2026-09-20" }));
      costRollup.seed(cell({ day: "2026-09-20", model: "gpt-5-mini", ...EUR }));
      costRollup.seed(cell({ day: "2026-09-21" }));
      costRollup.seed(
        cell({ day: "2026-09-21", model: "o3", amountNanoUsd: null, amountNanoMinor: 0 }),
      );

      const [kept, gapped] = (await read()).series;

      expect(kept).toMatchObject({ day: "2026-09-20", billedUsd: 1, billedCellsWithoutAmount: 0 });
      expect(kept?.billedCurrenciesWithoutUsdAmount).toEqual(["EUR"]);
      expect(gapped).toMatchObject({
        day: "2026-09-21",
        billedUsd: null,
        billedCellsWithoutAmount: 1,
      });
    });
  });

  describe("given a day whose bill was reissued in another currency", () => {
    /** @scenario "A bill reissued in another currency reads as a revision, not as new spend" */
    /** @scenario "A day reissued in another currency names what it held before, not the two amounts added together" */
    it("names what each currency held before the reissue and sums none of them together", async () => {
      const { costRollup, read } = setup();
      const revisedAt = Date.parse("2026-09-20T10:00:00Z") / 1000;
      costRollup.seed(
        cell({
          amountNanoUsd: 0,
          amountNanoMinor: 0,
          revisedAt,
          previousAmountNanoUsd: 3_000_000_000,
        }),
      );
      costRollup.seed(cell({ model: "gpt-5-eu", ...EUR, createdAt: revisedAt * 1000 + 1000 }));

      const [day] = (await read()).series;

      expect(day?.billedRevisedAt).toBe(revisedAt * 1000);
      expect(day?.billedByCurrency).toEqual([
        { currencyCode: "EUR", amount: 5, previousAmount: null },
        { currencyCode: "USD", amount: 0, previousAmount: 3 },
      ]);
    });
  });

  describe("given metered spend recorded in the gateway ledger", () => {
    /** @scenario "The metered lane counts gateway spend from every project of the organization" */
    it("reads the ledger across every project tenant of the organization", async () => {
      const days = [
        gatewayDay({ amountNanoUsd: 4_000_000_000, requestCount: 2, pricedRequestCount: 2 }),
      ];
      const { read, gatewayAsked } = setup({ gatewayDays: async () => days });

      const summary = await read();

      expect(gatewayAsked).toEqual([
        { tenantIds: ["proj-a", "proj-b"], fromDay: "2026-08-27", toDay: "2026-09-25" },
      ]);
      expect(summary.gateway.amountUsd).toBe(4);
      expect(summary.series[0]).toMatchObject({
        day: "2026-09-20",
        gatewayUsd: 4,
        billedUsd: null,
      });
    });

    /** @scenario "Requests with no dollar amount are counted beside the metered total, not inside it" */
    it("shows the priced total and counts the requests with no dollar amount beside it", async () => {
      const day = gatewayDay({
        amountNanoUsd: 2_000_000_000,
        requestCount: 3,
        pricedRequestCount: 2,
        requestsWithoutAmount: 1,
      });
      const summary = await setup({ gatewayDays: async () => [day] }).read();

      expect(summary.gateway.amountUsd).toBe(2);
      expect(summary.gateway.requestsWithoutAmount).toBe(1);
    });

    /** @scenario "A window of only requests with no dollar amount still shows the metered lane" */
    it("holds no figure for a day of only charged requests the ledger could not price", async () => {
      const day = gatewayDay({ requestCount: 2, requestsWithoutAmount: 2 });
      const summary = await setup({ gatewayDays: async () => [day] }).read();

      expect(summary.gateway).toMatchObject({
        amountUsd: null,
        requestsWithoutAmount: 2,
        currencyTotals: [],
      });
      expect(summary.series[0]?.gatewayUsd).toBeNull();
    });

    /** @scenario "A failed gateway ledger read never renders the metered lane as zero" */
    it("rejects the whole summary when the ledger read fails while the rollup resolves", async () => {
      const { read } = setup({
        gatewayDays: async () => {
          throw new Error("ledger unreachable");
        },
      });

      await expect(read()).rejects.toThrow("ledger unreachable");
    });
  });

  describe("given the markers a day carries about how far to trust its figure", () => {
    const DAY = 86_400;
    const nowSeconds = Date.parse("2026-09-25T12:00:00Z") / 1000;

    /** @scenario "A day a pull touched recently can still change" */
    it("marks a day touched inside the settling window as able to still change", async () => {
      const { costRollup, read } = setup();
      costRollup.seed(cell({ lastObservedAt: nowSeconds - 2 * DAY }));

      const [day] = (await read()).series;

      expect(day?.billedProvisional).toBe(true);
    });

    /** @scenario "A day no pull has touched for longer than the settling window reads settled" */
    it("reads a day untouched for longer than the settling window as settled", async () => {
      const { costRollup, read } = setup();
      costRollup.seed(cell({ lastObservedAt: nowSeconds - 60 * DAY }));

      const [day] = (await read()).series;

      expect(day?.billedProvisional).toBe(false);
    });

    /** @scenario "A day summarized before the markers existed reads as settled" */
    it("reads a day with no recorded pull touch as settled and not revised", async () => {
      const { costRollup, read } = setup();
      costRollup.seed(cell({}));

      const [day] = (await read()).series;

      expect(day).toMatchObject({ billedProvisional: false, billedRevisedAt: null });
    });

    /** @scenario "A day that was revised and can still change says both" */
    it("says a restated day was revised, what it held, and that it may still change", async () => {
      const { costRollup, read } = setup();
      const revisedAt = nowSeconds - DAY;
      costRollup.seed(
        cell({
          amountNanoUsd: 5_000_000_000,
          amountNanoMinor: 5_000_000_000,
          revisedAt,
          previousAmountNanoUsd: 3_000_000_000,
          lastObservedAt: revisedAt,
        }),
      );

      const [day] = (await read()).series;

      expect(day).toMatchObject({
        billedUsd: 5,
        billedRevisedAt: revisedAt * 1000,
        billedProvisional: true,
      });
      expect(day?.billedByCurrency).toEqual([
        { currencyCode: "USD", amount: 5, previousAmount: 3 },
      ]);
    });

    /** @scenario "Gateway days never claim they might change" */
    it("marks no gateway day as able to still change", async () => {
      const day = gatewayDay({
        amountNanoUsd: 2_000_000_000,
        requestCount: 1,
        pricedRequestCount: 1,
      });
      const summary = await setup({ gatewayDays: async () => [day] }).read();

      expect(summary.series[0]).toMatchObject({ gatewayUsd: 2, billedProvisional: false });
    });

    /** @scenario "A revised day whose earlier figure cannot be stated in dollars withholds it" */
    it("marks the day revised but names no earlier amount when part of it holds no dollars", async () => {
      const { costRollup, read } = setup();
      const revisedAt = nowSeconds - DAY;
      costRollup.seed(cell({ model: "gpt-5-eu", ...EUR, revisedAt, lastObservedAt: revisedAt }));

      const [day] = (await read()).series;

      expect(day?.billedRevisedAt).toBe(revisedAt * 1000);
      expect(day?.billedByCurrency).toEqual([
        { currencyCode: "EUR", amount: 5, previousAmount: null },
      ]);
    });
  });
});
