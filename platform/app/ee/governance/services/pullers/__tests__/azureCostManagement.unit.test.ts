// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Reading Azure Cost Management's daily reply.
 *
 * Every assertion here is against a REAL captured reply from a live
 * subscription (2026-08-30, 44 rows), not a shape invented to match the code.
 * The three things that reply got wrong about the obvious design are all
 * pinned below: the day arrives as a packed integer rather than a date, an
 * unrequested `Currency` column arrives in the middle of the row so positions
 * cannot be assumed, and every amount is a JSON float.
 *
 * Spec: specs/ai-governance/puller-framework/copilot-studio-dataverse.feature
 * Decision: ADR-128 §3.
 */
import { describe, expect, it } from "vitest";

import {
  AZURE_COST_MAX_HOLD_MS,
  AZURE_COST_REREAD_DAYS,
  azureCostReadIsDue,
  azureCostReadWindow,
  azureCostRequestBody,
  nextAzureCostCursor,
  readAzureCostRows,
} from "../azureCostManagement";
import capturedReply from "./fixtures/azureCostManagementDailyResponse.json";

/** A reply built from named columns, so a test can vary one thing at a time. */
function replyOf({
  columns,
  rows,
  nextLink = null,
}: {
  columns: string[];
  rows: unknown[][];
  nextLink?: string | null;
}) {
  return {
    properties: {
      columns: columns.map((name) => ({
        name,
        type:
          name === "MeterCategory" || name === "Currency" ? "String" : "Number",
      })),
      rows,
      nextLink,
    },
  };
}

describe("reading an Azure Cost Management daily reply", () => {
  describe("when the reply is the one a live subscription actually sent", () => {
    /** @scenario "The daily bill is read as the currency the customer is billed in" */
    it("reads every row, in the currency the subscription is billed in", () => {
      const read = readAzureCostRows({ response: capturedReply });

      expect(read.days).toHaveLength(44);
      expect(read.unreadableRows).toBe(0);
      expect(new Set(read.days.map((d) => d.currencyCode))).toEqual(
        new Set(["EUR"]),
      );
    });

    /** @scenario "The daily bill is read as the currency the customer is billed in" */
    it("keeps Microsoft's own dollar figure separate from the billed amount", () => {
      const read = readAzureCostRows({ response: capturedReply });
      const loadBalancer = read.days.find(
        (d) => d.day === "2026-08-23" && d.meterCategory === "Load Balancer",
      );

      // The two are different numbers by design: 0.527... euros is what the
      // customer is billed, 0.60 is Microsoft's own conversion of it. Nothing
      // here derives one from the other.
      expect(loadBalancer?.costMinor).toBe("0.527171286737249");
      expect(loadBalancer?.costUsd).toBe("0.6");
    });

    /** @scenario "The day a bill arrives packed as digits is read as a calendar day" */
    it("reads the packed integer day as the calendar day it names", () => {
      const read = readAzureCostRows({ response: capturedReply });

      // The reply says 20260823, which is a Number column, not a date.
      expect(read.days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.day))).toBe(
        true,
      );
      expect(new Set(read.days.map((d) => d.day))).toContain("2026-08-23");
      expect(new Set(read.days.map((d) => d.day))).toContain("2026-08-30");
    });

    /** @scenario "The daily bill is read as the currency the customer is billed in" */
    it("keeps a sub-cent amount's digits rather than rounding it to nothing", () => {
      const read = readAzureCostRows({ response: capturedReply });
      const tiny = read.days.find(
        (d) => d.day === "2026-08-30" && d.meterCategory === "Azure Databricks",
      );

      // 4.88476914290735e-06 in the reply. Carried as the exact digits that
      // arrived, in whichever notation JavaScript renders them, because
      // usdToNanoUsd reads exponent form.
      expect(Number(tiny?.costMinor)).toBeCloseTo(4.88476914290735e-6, 20);
      expect(tiny?.costMinor).not.toBe("0");
    });
  });

  describe("when the reply puts its columns in a different order", () => {
    /** @scenario "The daily bill is read as the currency the customer is billed in" */
    it("reads each value by its column name, never by its position", () => {
      // `Currency` was never requested and arrived anyway, in the middle of
      // the row. A reader keyed on position would read the currency as a
      // meter category and the meter category as money.
      const read = readAzureCostRows({
        response: replyOf({
          columns: [
            "Currency",
            "MeterCategory",
            "UsageDate",
            "CostUSD",
            "Cost",
          ],
          rows: [["EUR", "Load Balancer", 20260823, 0.6, 0.527171286737249]],
        }),
      });

      expect(read.days).toEqual([
        {
          day: "2026-08-23",
          meterCategory: "Load Balancer",
          costMinor: "0.527171286737249",
          costUsd: "0.6",
          currencyCode: "EUR",
        },
      ]);
    });
  });

  describe("when the reply names no currency", () => {
    /** @scenario "The daily bill is read as the currency the customer is billed in" */
    it("falls back to dollars rather than guessing", () => {
      const read = readAzureCostRows({
        response: replyOf({
          columns: ["Cost", "UsageDate", "MeterCategory"],
          rows: [[1.25, 20260823, "Storage"]],
        }),
      });

      expect(read.days[0]?.currencyCode).toBe("USD");
      // No CostUSD column: there is no separate biller figure to carry, and
      // the amount is already in dollars.
      expect(read.days[0]?.costUsd).toBe(null);
    });
  });

  describe("when a row cannot be read", () => {
    /** @scenario "The daily bill is read as the currency the customer is billed in" */
    it("counts it and keeps the rows that can", () => {
      const read = readAzureCostRows({
        response: replyOf({
          columns: ["Cost", "UsageDate", "MeterCategory", "Currency"],
          rows: [
            [1.25, 20260823, "Storage", "EUR"],
            ["not a number", 20260823, "Bandwidth", "EUR"],
            [1.25, 999, "Broken day", "EUR"],
            [2.5, 20260824, "Storage", "EUR"],
          ],
        }),
      });

      expect(read.days).toHaveLength(2);
      expect(read.unreadableRows).toBe(2);
    });

    /** @scenario "The daily bill is read as the currency the customer is billed in" */
    it("reads a credit as the negative amount it is", () => {
      const read = readAzureCostRows({
        response: replyOf({
          columns: [
            "Cost",
            "CostUSD",
            "UsageDate",
            "MeterCategory",
            "Currency",
          ],
          rows: [
            [-1.53352588022719, -1.74538248058057, 20260823, "Storage", "EUR"],
          ],
        }),
      });

      expect(read.days[0]?.costMinor).toBe("-1.53352588022719");
      expect(read.days[0]?.costUsd).toBe("-1.74538248058057");
    });
  });

  describe("when the reply offers another page", () => {
    /** @scenario "A cost reply spread over several pages is read whole" */
    it("reports the link so the caller can follow it", () => {
      const read = readAzureCostRows({
        response: replyOf({
          columns: ["Cost", "UsageDate", "MeterCategory"],
          rows: [[1.25, 20260823, "Storage"]],
          nextLink: "https://management.azure.com/next",
        }),
      });

      expect(read.nextLink).toBe("https://management.azure.com/next");
    });

    /** @scenario "A cost reply spread over several pages is read whole" */
    it("reports no link when the reply is complete, as the captured one is", () => {
      expect(readAzureCostRows({ response: capturedReply }).nextLink).toBe(
        null,
      );
    });
  });

  describe("when the reply is not the shape this reads at all", () => {
    /** @scenario "A re-read day the bill has not landed for emits no figure at all" */
    it("says so, rather than reading as a window that cost nothing", () => {
      const read = readAzureCostRows({ response: { error: "unauthorized" } });

      // An HTTP 200 carrying an error body. Reported as malformed, because
      // "no days" alone would let the caller mark the window priced and
      // publish a genuinely free week.
      expect(read.malformed).toBe(true);
      expect(read.days).toEqual([]);
    });

    /** @scenario "A re-read day the bill has not landed for emits no figure at all" */
    it("does not confuse a real but empty window with a malformed one", () => {
      const read = readAzureCostRows({
        response: replyOf({ columns: ["Cost", "UsageDate"], rows: [] }),
      });

      // Azure answering "this window cost nothing" is a real answer and has
      // to stay distinguishable from a reply nobody could parse.
      expect(read.malformed).toBe(false);
      expect(read.days).toEqual([]);
    });
  });

  describe("the window a run asks about", () => {
    /** @scenario "The first cost read asks about a window that covers the settling days" */
    it("reaches back over the settling days on a first read", () => {
      const window = azureCostReadWindow({
        nowMs: Date.parse("2026-08-30T09:00:00.000Z"),
        pricedThroughDay: null,
      });

      expect(window.toDay).toBe("2026-08-30");
      expect(window.fromDay).toBe("2026-08-24");
    });

    /** @scenario "A day already recorded is re-read and its figure replaced, not added to" */
    it("re-reads the trailing days it has already priced", () => {
      const window = azureCostReadWindow({
        nowMs: Date.parse("2026-08-30T09:00:00.000Z"),
        pricedThroughDay: "2026-08-29",
      });

      // Today is partial by construction — the captured reply shows today's
      // load balancer at 0.375 against 0.60 on every finished day — so a
      // window starting after the last priced day would never correct it.
      expect(window.fromDay).toBe("2026-08-24");
      expect(window.toDay).toBe("2026-08-30");
      expect(AZURE_COST_REREAD_DAYS).toBe(7);
    });

    /** @scenario "The first cost read asks about a window that covers the settling days" */
    it("never asks about days before a watermark that has fallen further behind", () => {
      const window = azureCostReadWindow({
        nowMs: Date.parse("2026-08-30T09:00:00.000Z"),
        pricedThroughDay: "2026-08-01",
      });

      // A source that has been paused must not be dragged forward to the
      // trailing window, which would skip everything in between and then
      // report a complete sweep.
      expect(window.fromDay).toBe("2026-08-02");
    });
  });

  describe("the request a run sends", () => {
    /** @scenario "The daily bill is read as the currency the customer is billed in" */
    it("asks for both the billed amount and Microsoft's own dollar figure", () => {
      const body = azureCostRequestBody({
        fromDay: "2026-08-24",
        toDay: "2026-08-30",
      });

      expect(body.type).toBe("ActualCost");
      expect(body.timeframe).toBe("Custom");
      expect(body.dataset.granularity).toBe("Daily");
      expect(Object.keys(body.dataset.aggregation).sort()).toEqual([
        "totalCost",
        "totalCostUSD",
      ]);
      expect(body.timePeriod.from).toBe("2026-08-24T00:00:00+00:00");
      expect(body.timePeriod.to).toBe("2026-08-30T23:59:59+00:00");
    });
  });

  /**
   * When a run is allowed to ask at all.
   *
   * A live subscription proved the cost of getting this wrong: asking on every
   * run at a five-minute schedule drew a flat refusal from Cost Management,
   * and the source read the bill zero times in half an hour.
   */
  describe("whether the bill is due to be asked about", () => {
    const NOW_MS = Date.parse("2026-08-30T09:00:00.000Z");
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    /** @scenario "The bill is not asked about on every run" */
    it("is not due a few minutes after it was last asked about", () => {
      expect(
        azureCostReadIsDue({ nowMs: NOW_MS, readAtMs: NOW_MS - 5 * 60_000 }),
      ).toBe(false);
    });

    /** @scenario "The bill is not asked about on every run" */
    it("is still not due an hour after it was last asked about", () => {
      // Deliberately written as an hour rather than as a fraction of the
      // interval. An expectation phrased in terms of the constant it is meant
      // to pin moves whenever the constant does, and would stay green if the
      // interval were cut back to minutes — which is the failure this gate
      // exists to prevent.
      expect(
        azureCostReadIsDue({ nowMs: NOW_MS, readAtMs: NOW_MS - 60 * 60_000 }),
      ).toBe(false);
    });

    /** @scenario "The bill is not asked about on every run" */
    it("is due half a day after it was last asked about", () => {
      // The other side of the same bound, also in absolute time: whatever the
      // interval is, twelve hours has to be enough, or a customer waits most
      // of a day for a figure Azure published this morning.
      expect(
        azureCostReadIsDue({
          nowMs: NOW_MS,
          readAtMs: NOW_MS - 12 * 60 * 60_000,
        }),
      ).toBe(true);
    });

    /** @scenario "A source that has never asked about the bill asks on its first run" */
    it("is due when the bill has never been asked about", () => {
      expect(azureCostReadIsDue({ nowMs: NOW_MS, readAtMs: null })).toBe(true);
    });

    /** @scenario "A record of asking that lies in the future does not stop the bill being read" */
    it("is due when the recorded ask lies in the future", () => {
      // A clock that moved backwards, or a position rewound by hand. Waiting
      // for real time to catch up would jam the source shut for as long as the
      // skew lasts, which nothing here can bound.
      expect(
        azureCostReadIsDue({ nowMs: NOW_MS, readAtMs: NOW_MS + ONE_DAY_MS }),
      ).toBe(true);
    });

    /**
     * How many times a source pulling continuously actually gets to ask, over
     * a given span.
     *
     * Runs the gate the way the puller runs it — every run either asks and
     * records the instant, or is turned away — rather than dividing one
     * constant by another. Arithmetic over two literals would hold for any
     * pair of values; this fails if the gate itself stops turning runs away.
     *
     * The five-minute step is this helper's own sampling rate, not a claim
     * about how anyone schedules a source. The gate never sees a schedule; it
     * reads elapsed time, so any step well under the interval gives the same
     * answer.
     */
    const asksOverSpan = (spanMs: number): number => {
      const RUN_EVERY_MS = 5 * 60_000;
      let readAtMs: number | null = null;
      let asks = 0;
      for (let nowMs = NOW_MS; nowMs < NOW_MS + spanMs; nowMs += RUN_EVERY_MS) {
        if (azureCostReadIsDue({ nowMs, readAtMs })) {
          asks += 1;
          readAtMs = nowMs;
        }
      }
      return asks;
    };

    /** @scenario "The bill is asked about a handful of times a day" */
    it("asks a handful of times a day, not once and not on every run", () => {
      const asksInADay = asksOverSpan(ONE_DAY_MS);
      expect(asksInADay).toBeGreaterThan(1);
      // Azure publishes the figure once a day and refused us outright at 288
      // asks a day. Two dozen is the ceiling that keeps this a gate rather
      // than a formality.
      expect(asksInADay).toBeLessThan(24);
    });

    /** @scenario "A window that cannot be read is asked about many times before it is given up on" */
    it("asks many times over before a held window would be given up on", () => {
      // The two bounds have to be read together. An interval longer than the
      // give-up cap would abandon every held window before the next ask was
      // ever due, and a customer would never see a figure at all.
      expect(asksOverSpan(AZURE_COST_MAX_HOLD_MS)).toBeGreaterThan(10);
    });

    /** @scenario "A successful read records that the bill was asked about even when no figure changed" */
    it("records the instant of the ask whether the window priced or was held", () => {
      // Without this the gate has nothing to read: a run that asked but did
      // not write it down is due again on the very next run.
      expect(
        nextAzureCostCursor({
          nowMs: NOW_MS,
          previous: { pricedThroughDay: "2026-08-30", heldSinceMs: null },
          outcome: "priced",
        }).readAtMs,
      ).toBe(NOW_MS);
      expect(
        nextAzureCostCursor({
          nowMs: NOW_MS,
          previous: { pricedThroughDay: "2026-08-20", heldSinceMs: null },
          outcome: "held",
        }).readAtMs,
      ).toBe(NOW_MS);
    });
  });
});
