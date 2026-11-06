import { describe, expect, it } from "vitest";

import {
  barHeights,
  chartAxis,
  fullSeats,
  liteRow,
  monthEvents,
  projectShares,
  shortDate,
  type UsagePagePlan,
} from "../usage-page-state.ts";

const FREE: UsagePagePlan = {
  type: "FREE",
  name: "Free",
  free: true,
  maxMembers: 2,
  maxMembersLite: 0,
  maxMessagesPerMonth: 50_000,
  planSource: "free",
};

describe("shortDate", () => {
  it("writes a day as its number and short month", () => {
    expect(shortDate("2026-12-01")).toBe("1 Dec");
  });
});

describe("chartAxis", () => {
  it("names the first, the fifteenth and the last day", () => {
    const days = Array.from({ length: 30 }, (_, index) => ({
      date: `2026-11-${String(index + 1).padStart(2, "0")}`,
      count: 0,
    }));
    expect(chartAxis(days)).toEqual(["1 Nov", "15 Nov", "30 Nov"]);
  });

  it("names nothing for a month with no days", () => {
    expect(chartAxis([])).toEqual([]);
  });
});

describe("barHeights", () => {
  it("draws each day against the busiest, a small day still visible and an empty day flat", () => {
    expect(
      barHeights([
        { date: "a", count: 100 },
        { date: "b", count: 1 },
        { date: "c", count: 0 },
      ]),
    ).toEqual([1, 0.04, 0]);
  });
});

describe("monthEvents", () => {
  describe("when the month reaches 80% of the allowance", () => {
    it("warns", () => {
      expect(
        monthEvents({ count: 40_000, plan: FREE, pricingModel: "SEAT_EVENT", currency: "EUR" }),
      ).toMatchObject({
        allowance: { kind: "cap", max: "50,000" },
        fillRatio: 0.8,
        status: "warning",
      });
    });
  });

  describe("when the month passes the allowance", () => {
    it("fills the meter and says it is exceeded", () => {
      expect(
        monthEvents({ count: 60_000, plan: FREE, pricingModel: "SEAT_EVENT", currency: "EUR" }),
      ).toMatchObject({ fillRatio: 1, status: "exceeded" });
    });
  });

  describe("given Growth billed in dollars", () => {
    it("quotes the dollar overage", () => {
      const growth = {
        ...FREE,
        free: false,
        type: "GROWTH_SEAT_USD_MONTHLY",
        planSource: "subscription" as const,
      };
      expect(
        monthEvents({ count: 10, plan: growth, pricingModel: "SEAT_EVENT", currency: "USD" })
          .allowance,
      ).toEqual({ kind: "overage", text: "200,000 included, then $6 per 100,000" });
    });
  });

  describe("given an Enterprise plan", () => {
    it("states no allowance and draws no meter, on either pricing model", () => {
      const enterprise = {
        ...FREE,
        free: false,
        type: "ENTERPRISE",
        maxMessagesPerMonth: 1_000_000,
        planSource: "subscription" as const,
      };
      for (const pricingModel of ["SEAT_EVENT", "TIERED"] as const) {
        expect(
          monthEvents({ count: 10, plan: enterprise, pricingModel, currency: "EUR" }),
        ).toMatchObject({ allowance: null, fillRatio: null });
      }
    });
  });

  describe("given a paid seat plan that is not Growth", () => {
    it("quotes no Growth overage", () => {
      const custom = {
        ...FREE,
        free: false,
        type: "CUSTOM_PLAN",
        maxMessagesPerMonth: 999_999_999,
        planSource: "subscription" as const,
      };
      expect(
        monthEvents({ count: 10, plan: custom, pricingModel: "SEAT_EVENT", currency: "EUR" })
          .allowance,
      ).toBeNull();
    });
  });
});

describe("projectShares", () => {
  it("gives each project its share of the month's total", () => {
    expect(projectShares([{ count: 3 }, { count: 1 }])).toEqual([0.75, 0.25]);
  });
});

describe("liteRow", () => {
  it("counts Lite members against a capped seat plan", () => {
    expect(
      liteRow({
        plan: { ...FREE, free: false, maxMembersLite: 10, planSource: "subscription" },
        pricingModel: "SEAT_EVENT",
        liteCount: 3,
      }),
    ).toEqual({ kind: "count", value: "3 / 10", note: null });
  });
});

describe("fullSeats", () => {
  it("shows only the count where the plan does not cap seats", () => {
    expect(fullSeats({ used: 12, plan: { ...FREE, maxMembers: 9_999 } })).toBe("12");
  });
});
