/**
 * @vitest-environment node
 *
 * The fold behind the "Cost by provider" panel.
 *
 * The panel is a chart, and a chart draws nothing under a test renderer with
 * no layout — its container measures zero and recharts declines to plot into
 * it. So the arithmetic is checked here, where it can be, rather than through
 * a DOM that would only ever show an empty box.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */
import { describe, expect, it } from "vitest";

import {
  costTotalBuckets,
  partialProviderNotes,
  providerDayBuckets,
  providerPeriods,
  providerSplitBuckets,
  rowIsShort,
  type WithheldBucket,
} from "../CostProviderDayPanel";
import { aggregateBuckets } from "../costsWindow";

/** Two providers billed across two quarters, every day carrying a figure. */
const ROWS = [
  {
    day: "2026-01-15",
    provider: "openai_admin",
    amountUsd: 60,
    cellsWithoutAmount: 0,
    currenciesWithoutUsdAmount: [],
  },
  {
    day: "2026-02-16",
    provider: "openai_admin",
    amountUsd: 30,
    cellsWithoutAmount: 0,
    currenciesWithoutUsdAmount: [],
  },
  {
    day: "2026-01-15",
    provider: "anthropic_admin",
    amountUsd: 41,
    cellsWithoutAmount: 0,
    currenciesWithoutUsdAmount: [],
  },
  {
    day: "2026-04-02",
    provider: "anthropic_admin",
    amountUsd: 9,
    cellsWithoutAmount: 0,
    currenciesWithoutUsdAmount: [],
  },
];

const seriesIn = (bucket: { points: Array<{ key: string; value: number }> }) =>
  Object.fromEntries(bucket.points.map((point) => [point.key, point.value]));

describe("the provider breakdown fold", () => {
  /** @scenario "A viewer can see the window split by provider over time" */
  it("gives each period a separate figure per provider, adding to each provider's window", () => {
    const folded = aggregateBuckets(providerDayBuckets(ROWS), "quarter");

    expect(folded).toHaveLength(2);
    // Each period carries a figure per provider, not one figure for the
    // period and one for the provider.
    expect(seriesIn(folded[0]!)).toEqual({
      openai_admin: 90,
      anthropic_admin: 41,
    });
    expect(seriesIn(folded[1]!)).toEqual({ anthropic_admin: 9 });

    // Read back out of the fold and held against the window, rather than
    // against the fixture: a split that draws one thing and totals another is
    // exactly the defect a reader would find by adding the bars up.
    const acrossWindow = (provider: string) =>
      folded.reduce(
        (total, bucket) => total + (seriesIn(bucket)[provider] ?? 0),
        0,
      );
    expect(acrossWindow("openai_admin")).toBe(90);
    expect(acrossWindow("anthropic_admin")).toBe(50);
  });

  /** @scenario "The untotalled cost chart is bucketed by the interval too" */
  it("folds the untotalled chart to one period per quarter as well", () => {
    const insideOneQuarter = ROWS.filter((row) => row.day < "2026-04-01");

    // The interval goes IN, so this covers what the panel actually hands the
    // chart. An earlier version of this took the fold as a second step the
    // caller applied, which is the step the panel had forgotten — so it
    // passed against the very screen it was written for.
    const folded = costTotalBuckets(insideOneQuarter, "quarter");

    // ONE bar, not three: three days of rows fall inside this quarter.
    expect(folded).toHaveLength(1);
    expect(folded[0]!.day).toBe("2026-01-01");
    // And its height is both providers added together: 60 + 30 + 41.
    expect(folded[0]!.points).toEqual([
      { key: "total", label: "Spend", value: 131 },
    ]);
  });

  /** @scenario "The provider breakdown is bucketed by the interval the reader chose" */
  it("folds days inside one quarter into a single period, provider by provider", () => {
    const insideOneQuarter = ROWS.filter((row) => row.day < "2026-04-01");

    const folded = aggregateBuckets(
      providerDayBuckets(insideOneQuarter),
      "quarter",
    );

    // Three days at two providers, all in Q1 — one period, two series.
    expect(folded).toHaveLength(1);
    expect(folded[0]!.day).toBe("2026-01-01");
    expect(seriesIn(folded[0]!)).toEqual({
      openai_admin: 90,
      anthropic_admin: 41,
    });
  });

  /** @scenario "The period a reader opens is the span its bar was drawn from" */
  it("spans a period from its first billed day to its last, not from the calendar", () => {
    const periods = providerPeriods(ROWS, "quarter");

    const q1 = periods.find(
      (period) =>
        period.provider === "openai_admin" && period.period === "2026-01-01",
    );
    // The quarter runs to 31 March and opens on 1 January; the bar was drawn
    // from two days inside it, and those two days are what its records have
    // to cover.
    expect(q1?.fromDay).toBe("2026-01-15");
    expect(q1?.toDay).toBe("2026-02-16");
    expect(q1?.amountUsd).toBe(90);
    expect(q1?.partial).toBe(false);
  });

  /** @scenario "The records behind a period cover every day the period holds" */
  it("covers every day the period holds and no day outside it", () => {
    const periods = providerPeriods(ROWS, "quarter");

    const inWindow = (from: string, to: string) =>
      ROWS.filter((row) => row.day >= from && row.day <= to);

    const q1 = periods.find(
      (period) =>
        period.provider === "openai_admin" && period.period === "2026-01-01",
    )!;
    const covered = inWindow(q1.fromDay, q1.toDay).filter(
      (row) => row.provider === "openai_admin",
    );
    // Both of this provider's Q1 days fall inside the span...
    expect(covered.map((row) => row.day)).toEqual(["2026-01-15", "2026-02-16"]);
    // ...and the day it was billed in the NEXT quarter does not, which is the
    // half a span taken from the calendar would have swallowed.
    const q2 = periods.find(
      (period) =>
        period.provider === "anthropic_admin" && period.period === "2026-04-01",
    )!;
    expect(q2.fromDay).toBe("2026-04-02");
    expect(q2.toDay).toBe("2026-04-02");
    expect(inWindow(q1.fromDay, q1.toDay)).not.toContainEqual(
      expect.objectContaining({ day: "2026-04-02" }),
    );
  });

  it("marks the period holding a withheld day as withheld, naming the provider", () => {
    const withWithheld = [
      {
        day: "2026-01-15",
        provider: "openai_admin",
        amountUsd: 60,
        cellsWithoutAmount: 0,
        currenciesWithoutUsdAmount: [],
      },
      {
        day: "2026-01-16",
        provider: "anthropic_admin",
        amountUsd: null,
        cellsWithoutAmount: 1,
        currenciesWithoutUsdAmount: [],
      },
      {
        day: "2026-04-02",
        provider: "anthropic_admin",
        amountUsd: 9,
        cellsWithoutAmount: 0,
        currenciesWithoutUsdAmount: [],
      },
    ];

    const folded = costTotalBuckets(withWithheld, "quarter");

    // The first quarter is SHORT: one of its days holds no dollar figure, so
    // the bar it draws is not the whole of what was spent. The bucket says
    // so, and says who, rather than leaving the height to speak for itself.
    expect(folded.map((bucket) => bucket.day)).toEqual([
      "2026-01-01",
      "2026-04-01",
    ]);
    expect(folded[0]).toMatchObject({
      withheld: true,
      withheldProviders: [{ provider: "anthropic_admin", currencies: [] }],
    });
    expect(seriesIn(folded[0]!)).toEqual({ total: 60 });
    // The second quarter holds every figure and carries no mark.
    expect(folded[1]).toMatchObject({ withheld: false, withheldProviders: [] });
    // And the note under the chart is read off those same buckets, so it
    // names exactly the provider whose bar is marked.
    expect(partialProviderNotes(folded)).toEqual(["Anthropic"]);
  });

  /** @scenario "The provider split marks a short period the same way the total chart does" */
  it("marks the same period short in the provider split as in the total chart", () => {
    const withWithheld = [
      {
        day: "2026-01-15",
        provider: "openai_admin",
        amountUsd: 60,
        cellsWithoutAmount: 0,
        currenciesWithoutUsdAmount: [],
      },
      {
        day: "2026-01-16",
        provider: "anthropic_admin",
        amountUsd: null,
        cellsWithoutAmount: 1,
        currenciesWithoutUsdAmount: [],
      },
      {
        day: "2026-04-02",
        provider: "anthropic_admin",
        amountUsd: 9,
        cellsWithoutAmount: 0,
        currenciesWithoutUsdAmount: [],
      },
    ];

    const total = costTotalBuckets(withWithheld, "quarter");
    const split = providerSplitBuckets(withWithheld, "quarter");

    // Same periods, same marks, same names: one fold read two ways. The
    // split used to be built straight from the day buckets, which know
    // nothing of withheld days, so the same quarter was faded on one chart
    // and plain on the other.
    const marksOf = (buckets: WithheldBucket[]) =>
      buckets.map(({ day, withheld, withheldProviders }) => ({
        day,
        withheld,
        withheldProviders,
      }));
    expect(marksOf(split)).toEqual(marksOf(total));
    expect(split[0]).toMatchObject({ day: "2026-01-01", withheld: true });
    // And the split still carries a figure per provider inside the period.
    expect(seriesIn(split[0]!)).toEqual({
      openai_admin: 60,
      anthropic_admin: 0,
    });
  });

  /** @scenario "A day billed partly in a currency with no dollar figure leaves its period short" */
  it("marks a period short when a day holds a dollar figure beside a bill in a currency with none", () => {
    const partlyInEuros = [
      {
        day: "2026-01-15",
        provider: "anthropic_admin",
        // A real figure — the dollar half of the day — with nothing null
        // about it. The euro half is the shortfall.
        amountUsd: 50,
        cellsWithoutAmount: 0,
        currenciesWithoutUsdAmount: ["EUR"],
      },
    ];

    // The one predicate every fold asks.
    expect(rowIsShort(partlyInEuros[0]!)).toBe(true);
    expect(rowIsShort({ amountUsd: 50, currenciesWithoutUsdAmount: [] })).toBe(
      false,
    );
    expect(
      rowIsShort({ amountUsd: null, currenciesWithoutUsdAmount: [] }),
    ).toBe(true);

    // The total chart's bucket is short and says in what currency...
    const total = costTotalBuckets(partlyInEuros, "quarter");
    expect(total[0]).toMatchObject({
      withheld: true,
      withheldProviders: [{ provider: "anthropic_admin", currencies: ["EUR"] }],
    });
    // ...as is the split's...
    expect(providerSplitBuckets(partlyInEuros, "quarter")[0]).toMatchObject({
      withheld: true,
    });
    // ...the note names the provider and the currency...
    expect(partialProviderNotes(total)).toEqual(["Anthropic (EUR)"]);
    // ...and the period a reader would open is partial. Before the one
    // predicate, the bucket and the period said whole while the note said
    // short: a whole bar drawn over a note contradicting it.
    expect(providerPeriods(partlyInEuros, "quarter")[0]?.partial).toBe(true);
  });

  it("lists a provider short in two ways once, with its currencies", () => {
    const shortBothWays = [
      {
        day: "2026-01-15",
        provider: "anthropic_admin",
        amountUsd: null,
        cellsWithoutAmount: 1,
        currenciesWithoutUsdAmount: [],
      },
      {
        day: "2026-04-02",
        provider: "anthropic_admin",
        amountUsd: 9,
        cellsWithoutAmount: 0,
        currenciesWithoutUsdAmount: ["GBP", "EUR"],
      },
    ];

    // Two periods, two kinds of short, one provider: one entry. Two would
    // read as two providers to a reader told which names to go and look at.
    expect(
      partialProviderNotes(costTotalBuckets(shortBothWays, "quarter")),
    ).toEqual(["Anthropic (EUR, GBP)"]);
  });

  it("counts a withheld day as no money rather than guessing at one", () => {
    const withWithheld = [
      {
        day: "2026-01-15",
        provider: "anthropic_admin",
        amountUsd: 41,
        cellsWithoutAmount: 0,
        currenciesWithoutUsdAmount: [],
      },
      {
        day: "2026-01-16",
        provider: "anthropic_admin",
        amountUsd: null,
        cellsWithoutAmount: 1,
        currenciesWithoutUsdAmount: [],
      },
    ];

    const folded = aggregateBuckets(
      providerDayBuckets(withWithheld),
      "quarter",
    );
    const periods = providerPeriods(withWithheld, "quarter");

    // The bar is the sum of the days that held a figure. It is SHORT, and
    // the panel says so beside it rather than inventing a height.
    expect(seriesIn(folded[0]!)).toEqual({ anthropic_admin: 41 });
    expect(periods[0]?.amountUsd).toBe(41);
    expect(periods[0]?.partial).toBe(true);
  });
});
