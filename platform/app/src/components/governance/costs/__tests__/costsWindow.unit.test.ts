/**
 * The folds that turn what the reads answer into the buckets the chips asked
 * for, and the ceiling that keeps a two-year frame from being served as one
 * year without saying so.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */
import { describe, expect, it } from "vitest";

import {
  aggregateBuckets,
  aggregateLaneSeries,
  aggregateLaneTrend,
  aggregateSeatCounts,
  bucketStartOf,
  formatBucketTick,
  frameExceedsReadCeiling,
  READ_WINDOW_DAY_CEILING,
  windowDaysForFrame,
} from "../costsWindow";
import { recentMonths, sampleForecast } from "../sampleSeries";

/** A lane day with every honesty field at its quiet default. */
const laneDay = (
  day: string,
  overrides: Partial<{
    billedUsd: number | null;
    gatewayUsd: number | null;
    billedCellsWithoutAmount: number;
    gatewayCellsWithoutAmount: number;
    billedRevisedAt: number | null;
    billedByCurrency: Array<{
      currencyCode: string;
      amount: number | null;
      previousAmount: number | null;
    }>;
    billedProvisional: boolean;
  }> = {},
) => ({
  day,
  billedUsd: 100,
  gatewayUsd: 80,
  billedCellsWithoutAmount: 0,
  gatewayCellsWithoutAmount: 0,
  billedRevisedAt: null,
  billedByCurrency: [],
  billedProvisional: false,
  ...overrides,
});

describe("bucketStartOf", () => {
  describe("when the interval is quarter", () => {
    it("puts every month of a quarter on the same start", () => {
      expect(bucketStartOf("2026-07-14", "quarter")).toBe("2026-07-01");
      expect(bucketStartOf("2026-08-01", "quarter")).toBe("2026-07-01");
      expect(bucketStartOf("2026-09-30", "quarter")).toBe("2026-07-01");
    });
  });

  describe("when the interval is year", () => {
    it("puts every day of a year on January the first", () => {
      expect(bucketStartOf("2026-11-30", "year")).toBe("2026-01-01");
    });
  });
});

describe("formatBucketTick", () => {
  describe("when the interval is quarter", () => {
    it("names the quarter rather than its first month", () => {
      // "Jul 2026" on a quarterly axis reads as July, which is a third of
      // what the bar covers.
      expect(formatBucketTick("2026-07-01", "quarter")).toBe("Q3 2026");
    });
  });

  describe("when the interval is year", () => {
    it("reads as the year alone", () => {
      expect(formatBucketTick("2026-01-01", "year")).toBe("2026");
    });
  });
});

describe("windowDaysForFrame", () => {
  describe("when the frame reaches past what the reads answer", () => {
    it("asks for the ceiling rather than a window the read would refuse", () => {
      // Every governance cost input caps windowDays at 365. Asking for 730
      // fails validation, and the reader lands on an error alert instead of
      // a screen.
      expect(windowDaysForFrame({ frame: "last_2_years" })).toBe(
        READ_WINDOW_DAY_CEILING,
      );
      expect(frameExceedsReadCeiling({ frame: "last_2_years" })).toBe(true);
    });
  });

  describe("when the frame fits", () => {
    it("asks for the frame's own span and reports no shortfall", () => {
      expect(windowDaysForFrame({ frame: "last_3_months" })).toBe(90);
      expect(frameExceedsReadCeiling({ frame: "last_3_months" })).toBe(false);
    });
  });
});

describe("aggregateBuckets", () => {
  describe("when days inside one quarter carry the same series", () => {
    it("sums the series across the quarter", () => {
      const folded = aggregateBuckets(
        [
          { day: "2026-07-04", points: [{ key: "a", label: "A", value: 10 }] },
          { day: "2026-08-09", points: [{ key: "a", label: "A", value: 5 }] },
        ],
        "quarter",
      );

      expect(folded).toEqual([
        { day: "2026-07-01", points: [{ key: "a", label: "A", value: 15 }] },
      ]);
    });
  });
});

describe("aggregateSeatCounts", () => {
  describe("when three months inside one quarter each report a count", () => {
    /** @scenario "Seat counts fold to the last period in the bucket, never the sum" */
    it("reports the last month's count, not the three added together", () => {
      const months = ["2026-07-01", "2026-08-01", "2026-09-01"].map(
        (day, index) => ({
          day,
          points: [
            { key: "bought", label: "Seats bought", value: 420 },
            { key: "assigned", label: "Seats assigned", value: 300 + index },
          ],
        }),
      );

      const folded = aggregateSeatCounts(months, "quarter");

      expect(folded).toHaveLength(1);
      expect(folded[0]?.day).toBe("2026-07-01");
      // 1,260 is what the money fold would say, and nobody holds 1,260 seats.
      expect(folded[0]?.points).toEqual([
        { key: "bought", label: "Seats bought", value: 420 },
        { key: "assigned", label: "Seats assigned", value: 302 },
      ]);
    });
  });
});

describe("aggregateLaneSeries", () => {
  describe("when every day in the period holds a figure", () => {
    it("sums them onto the period's own start", () => {
      const folded = aggregateLaneSeries(
        [laneDay("2026-07-04"), laneDay("2026-08-09")],
        "quarter",
      );

      expect(folded).toHaveLength(1);
      expect(folded[0]?.day).toBe("2026-07-01");
      expect(folded[0]?.billedUsd).toBe(200);
      expect(folded[0]?.gatewayUsd).toBe(160);
    });
  });

  describe("when one day in the period holds no figure", () => {
    /** @scenario "A period containing a day with no figure holds no figure either" */
    it("withholds the period's figure rather than summing what is left", () => {
      const folded = aggregateLaneSeries(
        [
          laneDay("2026-07-04"),
          laneDay("2026-07-09", {
            billedUsd: null,
            billedCellsWithoutAmount: 3,
          }),
        ],
        "month",
      );

      // 100 would be a total lower than the month cost, with nothing on the
      // chart saying so — the lie the per-day figure already refuses to tell.
      expect(folded[0]?.billedUsd).toBeNull();
      expect(folded[0]?.billedCellsWithoutAmount).toBe(3);
      // The other lane answered in full, so it keeps its figure.
      expect(folded[0]?.gatewayUsd).toBe(160);
    });
  });

  describe("when one day in the period was restated", () => {
    /** @scenario "A period containing a restated day is itself marked restated" */
    it("marks the period restated and keeps the most recent date", () => {
      const folded = aggregateLaneSeries(
        [
          laneDay("2026-07-04", {
            billedRevisedAt: 1_000,
            billedByCurrency: [
              { currencyCode: "USD", amount: 100, previousAmount: 90 },
            ],
          }),
          laneDay("2026-08-09", {
            billedRevisedAt: 9_000,
            billedByCurrency: [
              { currencyCode: "USD", amount: 80, previousAmount: 70 },
            ],
            billedProvisional: true,
          }),
        ],
        "quarter",
      );

      expect(folded[0]?.billedRevisedAt).toBe(9_000);
      // The fold adds each currency to its own line down the period, never
      // across lines. Both days are dollars here, so the dollar line carries
      // the whole 160.
      expect(
        folded[0]?.billedByCurrency.find((line) => line.currencyCode === "USD")
          ?.previousAmount,
      ).toBe(160);
      expect(folded[0]?.billedProvisional).toBe(true);
    });
  });

  describe("when only one day of the period carries a prior figure", () => {
    it("withholds the prior figure, because a partial one reads as the whole", () => {
      const folded = aggregateLaneSeries(
        [
          laneDay("2026-07-04", {
            billedRevisedAt: 1_000,
            billedByCurrency: [
              { currencyCode: "USD", amount: 100, previousAmount: 90 },
            ],
          }),
          laneDay("2026-07-09", {
            billedByCurrency: [
              { currencyCode: "USD", amount: 50, previousAmount: null },
            ],
          }),
        ],
        "month",
      );

      expect(folded[0]?.billedRevisedAt).toBe(1_000);
      expect(
        folded[0]?.billedByCurrency.find((line) => line.currencyCode === "USD")
          ?.previousAmount,
      ).toBeNull();
    });
  });
});

/**
 * The forecast panel's projection marker.
 *
 * The marker is a day. The buckets under it are folded to the interval in
 * view. Unless the marker is folded by the same rule, it names an x value the
 * chart has no bucket for, and recharts draws nothing at all — silently, since
 * a reference line with no match is not an error.
 */
describe("given a lane series read per day and a quarter in view", () => {
  /** @scenario "A lane sparkline is bucketed by the interval in view like every other chart" */
  it("folds the sparkline to one point per quarter, withheld quarters included", () => {
    const folded = aggregateLaneTrend(
      [
        { day: "2026-01-05", value: 10 },
        { day: "2026-02-11", value: 20 },
        { day: "2026-03-30", value: 30 },
        // A whole quarter the read would not price. It stays on the chart as a
        // gap rather than a floor — a zero here claims nothing was spent.
        { day: "2026-04-02", value: null },
        { day: "2026-05-09", value: null },
        { day: "2026-07-01", value: 7 },
      ],
      "quarter",
    );

    expect(folded).toEqual([
      { day: "2026-01-01", value: 60 },
      { day: "2026-04-01", value: null },
      { day: "2026-07-01", value: 7 },
    ]);
  });

  it("totals the days it does have when only some of a quarter is withheld", () => {
    const folded = aggregateLaneTrend(
      [
        { day: "2026-01-05", value: null },
        { day: "2026-02-11", value: 20 },
      ],
      "quarter",
    );

    expect(folded).toEqual([{ day: "2026-01-01", value: 20 }]);
  });
});

describe("given a forecast whose window is part served and part projected", () => {
  const measuredMonths = recentMonths(12);
  const forecast = sampleForecast({
    days: measuredMonths,
    labels: ["checkout-agent"],
    monthlyTopValue: 400,
  });
  const drawnBuckets = [...forecast.measured, ...forecast.projected];

  /** @scenario "The projection marker survives the fold to any interval" */
  it.each([
    "month",
    "quarter",
    "year",
  ] as const)("names a bucket the chart draws, folded to %s", (interval) => {
    const drawn = aggregateBuckets(drawnBuckets, interval);
    const marker = bucketStartOf(forecast.projectedFromDay ?? "", interval);

    expect(drawn.map((bucket) => bucket.day)).toContain(marker);
  });

  /** @scenario "The forecast projects months the window does not contain" */
  it("projects past the end of the measured window", () => {
    const lastMeasured = measuredMonths[measuredMonths.length - 1] ?? "";

    // The whole complaint this replaced: shading the tail of the window and
    // calling it a projection meant every month drawn had already happened.
    expect(forecast.projected.length).toBeGreaterThan(0);
    for (const bucket of forecast.projected) {
      expect(bucket.day > lastMeasured).toBe(true);
    }
    expect(forecast.projectedFromDay).toBe(forecast.projected[0]?.day);
  });

  /** @scenario "A projected month is a run rate, not another roll of the dice" */
  it("carries a steady run rate forward rather than re-rolling the noise", () => {
    const values = forecast.projected.map(
      (bucket) => bucket.points[0]?.value ?? 0,
    );
    const measuredValues = forecast.measured.map(
      (bucket) => bucket.points[0]?.value ?? 0,
    );

    // Projected months drift by a fixed rate, so successive months never move
    // by more than the drift. Measured months are noisy on purpose, so the
    // same test applied to them would fail — which is what makes this one
    // evidence of anything.
    const spread = (series: number[]) =>
      series
        .slice(1)
        .map((value, index) => Math.abs(value - (series[index] ?? 0)))
        .reduce((largest, step) => Math.max(largest, step), 0);

    expect(spread(values)).toBeLessThan(spread(measuredValues));
  });

  it("puts the bucket holding the split on the projected side, not the served one", () => {
    const split = forecast.projectedFromDay ?? "";
    const marker = bucketStartOf(split, "quarter");

    // Rounding down is what does this: the marker opens no later than the
    // split, so every projected day sits at or after it. The reverse would
    // leave part of the run-rate drawn as spend, which is the one error
    // worth engineering against.
    expect(marker <= split).toBe(true);
  });
});
