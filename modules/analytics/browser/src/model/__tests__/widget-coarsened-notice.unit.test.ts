/**
 * What a coarsened widget tells the member: since the substitution is
 * otherwise invisible, the notice must name *both* steps (asked-for and
 * used) and cite the ceiling that forced the change, not a bare number.
 * @see specs/lwql/saved-charts.feature
 */

import { LWQL_GRANULARITY_MAX_BUCKETS } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { widgetCoarsenedNotice } from "../widget-coarsened-notice.ts";

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
