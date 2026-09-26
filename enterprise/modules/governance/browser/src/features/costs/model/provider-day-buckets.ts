// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { type GovernanceCostProviderDayRow } from "@langwatch/enterprise-governance-contract";

import { aggregateBuckets } from "./costs-window.ts";
import {
  markWithheldPeriods,
  providerDayBuckets,
  type WithheldBucket,
} from "./provider-periods.ts";
import { type TimeInterval } from "./time-controls.ts";

/**
 * One (period, provider) figure: the days it covers, and what they came to.
 *
 * `fromDay` and `toDay` are the FIRST AND LAST DAY THAT ACTUALLY CARRIED A ROW
 * inside the period, not the calendar bounds of the period itself. The two
 * differ for the period the window opens or closes on, and the rows are what
 * the bar was drawn from — so taking the range from them is what keeps the
 * records under a bar equal to the bar, including on a quarter the window only
 * caught three weeks of.
 */
export type ProviderPeriod = {
  provider: string;
  /** The period's first day as the fold names it, used as its identity. */
  period: string;
  fromDay: string;
  toDay: string;
  /** The sum of the days that held a figure. See `partial`. */
  amountUsd: number;
  /** Whether some day inside this period is short. See `rowIsShort`. */
  partial: boolean;
};

/**
 * The key every day's total is filed under.
 *
 * A chart of one series still needs a name for it, and "Spend" is what the
 * axis is already measuring — so the legend that would repeat it is turned
 * off at the call site rather than drawn saying nothing.
 */
export const TOTAL_SPEND_KEY = "total";

/**
 * The same rows with the provider dimension collapsed: what was spent, period
 * by period, and nothing about who charged it.
 *
 * Its own panel rather than a reading of the stacked one beside it. A stack
 * answers "which provider caused this period" and a reader has to add its
 * segments by eye to get the total; this answers "is the bill going up",
 * which is the first question anybody asks of a cost screen and the one the
 * stack makes hardest.
 *
 * NO SECOND READ. Both panels are folded from the rows `dailyByProvider`
 * already returned for the screen, so the total here and the stack beside it
 * can never disagree about a period — they are the same numbers added up two
 * ways.
 *
 * IT TAKES THE INTERVAL AND FOLDS, rather than answering days for the caller
 * to fold. The rollup stores days and the screen has no day interval to draw,
 * so unfolded output is never what a caller wants — and a caller that forgot
 * got a bar per day under an axis ticked by quarter, which repeated the
 * quarter's name over each run of three hundred hairline bars and made one
 * heavy day read as the whole quarter. There is now no unfolded value to
 * forget to fold.
 */
export function costTotalBuckets(
  rows: readonly GovernanceCostProviderDayRow[],
  interval: TimeInterval,
): WithheldBucket[] {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    // A withheld day adds nothing rather than being guessed at, exactly as it
    // does in the stack — and the bucket SAYS it is short, below. A bar
    // quietly drawn at the sum of the days that held a figure reads as a
    // cheap period, which is the one thing a withheld figure exists to
    // prevent.
    byDay.set(row.day, (byDay.get(row.day) ?? 0) + (row.amountUsd ?? 0));
  }
  const daily = [...byDay.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([day, value]) => ({
      day,
      points: [{ key: TOTAL_SPEND_KEY, label: "Spend", value }],
    }));
  return markWithheldPeriods(aggregateBuckets(daily, interval), rows, interval);
}

/**
 * The same rows folded to one period per interval, one series per provider:
 * what `Cost over time · by provider` draws.
 *
 * Marked by the SAME fold as the total chart. The two panels are folded from
 * one set of rows, so a period short in one is short in the other, and for a
 * while only the total chart said so: this one was built straight from
 * `aggregateBuckets`, which knows nothing of withheld days, so the same period
 * was drawn faded on the left and plain on the right.
 */
export function providerSplitBuckets(
  rows: readonly GovernanceCostProviderDayRow[],
  interval: TimeInterval,
): WithheldBucket[] {
  return markWithheldPeriods(aggregateBuckets(providerDayBuckets(rows), interval), rows, interval);
}
