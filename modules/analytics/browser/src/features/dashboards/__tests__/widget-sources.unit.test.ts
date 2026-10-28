/**
 * What a widget's card says about its queries' sources, and when it has none to count.
 * @see modules/dashboard/specs/dashboards-v2.feature AC200, AC200m
 */

import { describe, expect, it } from "vitest";

import { picksNoSources, widgetSourcesLine } from "../model/widget-sources.ts";

const query = (name: string, sources?: string[] | null) => ({
  name,
  sql: "SELECT 1",
  ...(sources === undefined ? {} : { sources: sources as never }),
});

describe("widgetSourcesLine", () => {
  /** @scenario "AC200f Sources: a query that stores none counts application traces" */
  it("names application for a query that stores none", () => {
    expect(widgetSourcesLine([query("main")])).toBe("Sources: application");
  });

  /** @scenario "AC200 Sources: each query shows its sources as pills, and the card names them" */
  it("names one shared set once, and each query's own set when they differ", () => {
    expect(
      widgetSourcesLine([
        query("a", ["application", "langy"]),
        query("b", ["application", "langy"]),
      ]),
    ).toBe("Sources: application, langy");
    expect(widgetSourcesLine([query("a", ["langy"]), query("b", [])])).toBe(
      "Sources: a: langy · b: none",
    );
  });

  /** @scenario "AC200m Sources: a query with no source picked counts nothing and says so" */
  it("says no sources are picked when every query stores none picked", () => {
    expect(widgetSourcesLine([query("a", []), query("b", [])])).toBe("No sources picked");
    expect(picksNoSources([query("a", []), query("b", [])])).toBe(true);
    expect(picksNoSources([query("a", []), query("b")])).toBe(false);
    expect(picksNoSources([])).toBe(false);
  });
});
