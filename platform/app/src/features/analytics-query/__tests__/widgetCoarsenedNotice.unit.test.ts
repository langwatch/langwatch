/**
 * What a coarsened widget tells the member.
 *
 * The notice exists because the substitution is otherwise invisible: the card
 * redraws at a coarser step and nothing on screen says the answer is not the
 * one the chart was configured to give. So the claims worth pinning are that it
 * names *both* steps — the one asked for and the one used — and that it cites
 * the ceiling that forced the change rather than asserting a bare number the
 * member cannot check.
 *
 * A pure function, tested as one: it lives in its own module precisely so this
 * suite does not have to mount a widget — and everything Chakra, tRPC and Vega
 * behind it — to read one sentence.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { describe, expect, it } from "vitest";

import { LWQL_GRANULARITY_MAX_BUCKETS } from "~/server/analytics/lwql/timeWindow";

import { widgetCoarsenedNotice } from "../logic/widgetCoarsenedNotice";

describe("the notice a coarsened widget shows", () => {
  it("names the step it used and the step it was asked for", () => {
    const notice = widgetCoarsenedNotice({ from: 60, to: 3600 });

    expect(notice).toContain("1-hour");
    expect(notice).toContain("1-minute");
    // The step used comes first: a swapped pair reads as a refinement, the
    // opposite of what happened.
    expect(notice.indexOf("1-hour")).toBeLessThan(notice.indexOf("1-minute"));
  });

  it("cites the datapoint ceiling that forced the change", () => {
    const notice = widgetCoarsenedNotice({ from: 1, to: 60 });

    // Read off the constant rather than written out, so a changed ceiling
    // cannot leave this suite asserting a number the product no longer uses.
    expect(notice).toContain(LWQL_GRANULARITY_MAX_BUCKETS.toLocaleString());
  });

  it("describes every offered step in words rather than seconds", () => {
    // The steps a member can pick are the three the contract offers; a notice
    // that said "3600-second" would be naming an implementation detail at the
    // one moment the member is being asked to trust the substitution.
    expect(widgetCoarsenedNotice({ from: 1, to: 60 })).toContain("1-second");
    expect(widgetCoarsenedNotice({ from: 60, to: 3600 })).toContain("1-minute");
    expect(widgetCoarsenedNotice({ from: 1, to: 3600 })).toContain("1-hour");
  });
});
