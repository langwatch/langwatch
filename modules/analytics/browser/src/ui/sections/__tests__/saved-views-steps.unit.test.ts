import { nowInstant, subDays } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  inViewOrder,
  keepOnFilterReset,
  periodFromUrlDates,
  urlCarriesViewParams,
  viewPeriodDates,
  withoutView,
  withViewRenamed,
} from "../saved-views-logic.ts";

const VIEWS = [
  { id: "a", name: "A" },
  { id: "b", name: "B" },
  { id: "c", name: "C" },
];

describe("saved view steps", () => {
  it("keeps only the page's own address on a filter reset", () => {
    expect(
      keepOnFilterReset({
        project: "p",
        view: "v",
        startDate: "s",
        "topics.topics": "t",
        query: "q",
      }),
    ).toEqual({ project: "p", view: "v", startDate: "s" });
  });

  it("turns a saved period into URL dates", () => {
    expect(viewPeriodDates(undefined)).toEqual({ startDate: undefined, endDate: undefined });
    expect(viewPeriodDates({ startDate: "2026-01-01", endDate: "2026-01-31" })).toEqual({
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });
    const relative = viewPeriodDates({ relativeDays: 7 });
    expect(relative.endDate).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(relative.startDate!.slice(0, 10)).toBe(
      subDays(nowInstant().epochMilliseconds, 6).toISOString().slice(0, 10),
    );
  });

  it("saves recent URL dates as a rolling window, older ones as fixed dates", () => {
    const today = nowInstant().toString().slice(0, 10);
    const weekAgo = subDays(nowInstant().epochMilliseconds, 6).toISOString().slice(0, 10);
    expect(periodFromUrlDates({ startDate: weekAgo, endDate: today })).toEqual({ relativeDays: 7 });
    expect(periodFromUrlDates({ startDate: "2025-01-01", endDate: "2025-01-10" })).toEqual({
      startDate: "2025-01-01",
      endDate: "2025-01-10",
    });
    expect(periodFromUrlDates({ startDate: undefined, endDate: today })).toBeUndefined();
  });

  it("reads view params from the address itself", () => {
    expect(urlCarriesViewParams("/p/analytics")).toBe(false);
    expect(urlCarriesViewParams("/p/analytics?view=x")).toBe(false);
    expect(urlCarriesViewParams("/p/analytics?query=hi")).toBe(true);
    expect(urlCarriesViewParams("/p/analytics?endDate=2026-01-01")).toBe(true);
    expect(urlCarriesViewParams("/p/analytics?topics=t1")).toBe(true);
  });

  it("removes, renames and reorders views, dropping unknown ids", () => {
    expect(withoutView(VIEWS, "b").map((v) => v.id)).toEqual(["a", "c"]);
    expect(withViewRenamed(VIEWS, "b", "Bee")[1]).toEqual({ id: "b", name: "Bee" });
    expect(inViewOrder(VIEWS, ["c", "x", "a"])).toEqual([
      { id: "c", name: "C", order: 0 },
      { id: "a", name: "A", order: 2 },
    ]);
  });
});
