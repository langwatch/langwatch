/** @see modules/staff-access/specs/staff-access-functions-activity.feature */
import { describe, expect, it } from "vitest";

import {
  mergeCodeCounts,
  plainCode,
  weekStartOf,
  weekStartsBack,
} from "../staff-access-activity-function.rules.ts";

describe("the activity function rules", () => {
  /** @scenario "A stored agent kind or failure code leaves as one plain word or as other" */
  it("keeps a plain code and collapses free text to other", () => {
    expect(plainCode("provider_rate_limited")).toBe("provider_rate_limited");
    expect(plainCode("Timeout after 30s: ACME prompt")).toBe("other");
    expect(plainCode("")).toBe("other");
    expect(
      mergeCodeCounts({ other: 1 }, [
        { code: "budget_exhausted", count: 2 },
        { code: "Some text", count: 3 },
      ]),
    ).toEqual({ other: 4, budget_exhausted: 2 });
    expect(mergeCodeCounts({}, [{ code: "constructor", count: 1 }])).toEqual({ constructor: 1 });
  });

  /** @scenario "Weeks are UTC Monday weeks counted back from the current one" */
  it("starts weeks on the UTC Monday and counts back from the current week", () => {
    const thursday = Date.parse("2026-11-05T15:00:00Z");

    expect(new Date(weekStartOf(thursday)).toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(new Date(weekStartOf(Date.parse("2026-11-02T00:00:00Z"))).toISOString()).toBe(
      "2026-11-02T00:00:00.000Z",
    );
    expect(new Date(weekStartOf(Date.parse("2026-11-08T23:59:59Z"))).toISOString()).toBe(
      "2026-11-02T00:00:00.000Z",
    );
    expect(
      weekStartsBack({ weeks: 3, at: thursday }).map((start) => new Date(start).toISOString()),
    ).toEqual(["2026-10-19T00:00:00.000Z", "2026-10-26T00:00:00.000Z", "2026-11-02T00:00:00.000Z"]);
  });
});
