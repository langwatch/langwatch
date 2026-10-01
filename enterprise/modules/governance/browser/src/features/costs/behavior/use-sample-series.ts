// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { useMemo } from "react";

import {
  ALL_DEPARTMENTS,
  aggregateBuckets,
  aggregateLine,
  aggregateSeatCounts,
  bucketStartOf,
} from "../model/costs-window.ts";
import {
  PROJECTION_MONTHS,
  SAMPLE_CONVERSATIONS_TOP,
  SAMPLE_MODELS,
  SAMPLE_MONTHLY_TOP,
  SAMPLE_PEOPLE,
  SAMPLE_WINDOW_TOTAL,
} from "../model/sample-figures.ts";
import {
  SAMPLE_AGENTS,
  SAMPLE_DEPARTMENTS,
  recentMonths,
  sampleDaily,
  sampleForecast,
  sampleLine,
  sampleRanked,
  sampleSeats,
} from "../model/sample-series.ts";
import { frameSpanDays, type TimeFrame, type TimeInterval } from "../model/time-controls.ts";
import { totalPerSeries } from "./use-breakdown-queries.ts";

/** Every invented series the breakdowns draw from, already folded. */
export type SampleSeries = ReturnType<typeof useSampleSeries>;

/**
 * The bucket starts the sample series are drawn on.
 *
 * Months, because the finest interval any chip offers is a month, so a year of
 * invented days would be folded away before anything drew it. The frame's full
 * span is used rather than the clamped one: nothing here is a read, so the
 * ceiling that applies to reads does not apply, and a two-year frame shows two
 * years of sample.
 */
export function useSamplePeriods(frame: TimeFrame): string[] {
  return useMemo(
    () => recentMonths(Math.max(1, Math.round(frameSpanDays({ frame }) / 30))),
    [frame],
  );
}

/**
 * Every placeholder series the page needs, folded to the chosen interval and
 * narrowed to the chosen department.
 *
 * The department chip filters the invented series exactly as it filters the
 * real ones: a chip that changed nothing while the reader watched would be a
 * demonstration of a control that does not work.
 */
export function useSampleSeries(periods: string[], interval: TimeInterval, department: string) {
  return useMemo(() => {
    const departments =
      department === ALL_DEPARTMENTS
        ? [...SAMPLE_DEPARTMENTS]
        : SAMPLE_DEPARTMENTS.filter((name) => name === department);

    // The two series every ranked panel is derived from, so a reader who adds
    // up the department bars gets the same figure the chart above them draws.
    const byDepartment = sampleDaily(periods, departments, SAMPLE_MONTHLY_TOP);
    const forecast = sampleForecast({
      days: periods,
      labels: SAMPLE_AGENTS.slice(0, 5),
      monthlyTopValue: SAMPLE_MONTHLY_TOP,
      monthsAhead: PROJECTION_MONTHS[interval],
    });

    return {
      // Ranked FROM the series rather than beside it. Generating both
      // independently is what made the old screen incoherent: the department
      // panel read $10.2k under a chart of the same money drawing $280k a
      // quarter, and a reader who noticed had learned only that the screen
      // does not add up.
      departments: totalPerSeries(byDepartment),
      // MEASURED ONLY. The forecast now runs a quarter past the end of the
      // window, and ranking agents by a total that included those months would
      // put money nobody has spent into a panel titled "Cost by agent".
      agents: totalPerSeries(forecast.measured),
      // These two have no series of their own on the page, so they are scaled
      // to the same window total by hand: a 0.42 decay sums to about 1.72x its
      // leader, which puts the leader near sixty per cent of the year.
      models: sampleRanked(SAMPLE_MODELS, SAMPLE_WINDOW_TOTAL * 0.58),
      users: sampleRanked(SAMPLE_PEOPLE, SAMPLE_WINDOW_TOTAL * 0.4),
      forecast: {
        // Measured months and projected months on one axis. The chart needs
        // them together — a forecast is only legible against what it continues
        // — and the fold is applied to the pair so a projected month cannot
        // land in a bucket the measured months were not folded into.
        buckets: aggregateBuckets([...forecast.measured, ...forecast.projected], interval),
        // The marker is folded by the same function that keys the buckets, so
        // it lands on a bucket the chart actually draws at every interval.
        //
        // It used to be dropped instead at anything wider than a month, on the
        // grounds that a day marker cannot point at a quarter boundary it does
        // not fall on. True, and the wrong remedy: quarter is the default, so
        // the panel called "forecast" drew no forecast on the view almost
        // everyone sees, and the run-rate tail read as money already spent.
        //
        // Folding rounds DOWN, which puts the whole bucket holding the split
        // on the projected side. That bucket is part measured, so this
        // understates what is known — and never the reverse. Showing a
        // projection as spend is the lie worth engineering against; calling a
        // few measured days projected only costs the reader some certainty.
        projectedFromDay: forecast.projectedFromDay
          ? bucketStartOf(forecast.projectedFromDay, interval)
          : null,
      },
      overTime: aggregateBuckets(byDepartment, interval),
      seats: aggregateSeatCounts(sampleSeats(periods), interval),
      conversations: aggregateBuckets(
        sampleDaily(periods, SAMPLE_AGENTS.slice(0, 6), SAMPLE_CONVERSATIONS_TOP),
        interval,
      ),
      tokens: aggregateLine(sampleLine(periods, "tokens", 3_000_000_000), interval),
    };
  }, [periods, interval, department]);
}
