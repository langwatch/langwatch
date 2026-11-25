// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { sampleAdoption } from "./sample-series.ts";
import { type TimeInterval } from "./time-controls.ts";

/**
 * What the invented money adds up to, and why these three numbers.
 *
 * Every sample figure on the screen is scaled from `SAMPLE_MONTHLY_TOP`, so
 * the lanes, the time charts and the ranked panels all describe one imaginary
 * organization rather than five. They were generated independently before,
 * which is how the department panel came to read $10.2k under a chart of the
 * same money drawing $280k a quarter — a screen that does not add up teaches a
 * reader to distrust the real one.
 *
 * `sampleDaily` decays each series by half, so five of them sum to about 1.94
 * times the leader; that is where the window total comes from.
 */
export const SAMPLE_MONTHLY_TOP = 7_400;
const SAMPLE_SERIES_DECAY_SUM = 1.94;
/** Roughly what a twelve-month window holds, for the panels with no series. */
export const SAMPLE_WINDOW_TOTAL = SAMPLE_MONTHLY_TOP * SAMPLE_SERIES_DECAY_SUM * 12;

/**
 * How busy the invented organization's agents are, in conversations.
 *
 * DERIVED, NOT PICKED. The conversation count used to be a round number chosen
 * on its own, which left it saying nothing about the same organization the
 * adoption panel describes two rows above. It is now that panel's own
 * headcount times a rate — a person who uses AI tools at work has about one
 * conversation a week — so the two panels answer to each other and a reader
 * who divides one by the other gets a number that means something.
 *
 * Six series decaying by half sum to about 1.97 times their leader, which is
 * where the divisor comes from.
 */
const SAMPLE_CONVERSATIONS_PER_PERSON_MONTH = 4.5;
const SAMPLE_SIX_SERIES_DECAY_SUM = 1.97;
export const SAMPLE_CONVERSATIONS_TOP = Math.round(
  (sampleAdoption().peopleUsingAiTools * SAMPLE_CONVERSATIONS_PER_PERSON_MONTH) /
    SAMPLE_SIX_SERIES_DECAY_SUM,
);

/** The models and people the ranked sample panels name. */
export const SAMPLE_MODELS = ["gpt-5-mini", "gpt-5", "claude-sonnet-5", "claude-haiku-4-5"];
export const SAMPLE_PEOPLE = [
  "ada@acme.test",
  "grace@acme.test",
  "alan@acme.test",
  "edsger@acme.test",
  "barbara@acme.test",
];

/**
 * How far the forecast reaches, per interval in view.
 *
 * A quarter ahead is the claim the panel wants to make, and at Month and
 * Quarter that is exactly what it makes. At YEAR it cannot: three projected
 * months fold into the same year bucket as the nine measured months before
 * them, and the bar that comes out holds spend and forecast added together
 * with nothing able to say which part is which. So a screen set to Year
 * reaches a year, where the projection gets a bucket of its own and the
 * measured years stay measured.
 *
 * The alternative was to draw no projection at Year, which is honest and
 * useless: the panel is named for a forecast and a reader who switched to
 * Year would find it had quietly stopped making one.
 */
export const PROJECTION_MONTHS: Record<TimeInterval, number> = {
  month: 3,
  quarter: 3,
  year: 12,
};
