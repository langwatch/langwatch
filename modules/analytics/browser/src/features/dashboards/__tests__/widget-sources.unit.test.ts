/**
 * What a widget's card says about its queries' sources, and when it has none to count.
 * @see modules/dashboard/specs/dashboards-v2.feature AC200, AC200m
 */

import { describe, expect, it } from "vitest";

import { picksNoSources, widgetSourcesLine } from "../model/widget-sources.ts";

const READS =
  "SELECT count() FROM trace_metrics WHERE Source IN {dashboard_context_sources:Array(String)}";
const IGNORES = "SELECT count() FROM trace_metrics";
const NO_ORIGIN = "SELECT count() FROM trace_metrics_by_minute";

const query = (name: string, sources?: string[] | null, sql = READS) => ({
  name,
  sql,
  ...(sources === undefined ? {} : { sources: sources as never }),
});

describe("widgetSourcesLine", () => {
  /** @scenario "AC200f Sources: a query that stores none counts application traces" */
  it("names application for an unset query", () => {
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
  it("says no sources are picked when every query's list is empty", () => {
    expect(widgetSourcesLine([query("a", []), query("b", [])])).toBe("No sources picked");
    expect(picksNoSources([query("a", []), query("b", [])])).toBe(true);
    expect(picksNoSources([query("a", []), query("b")])).toBe(false);
    expect(picksNoSources([])).toBe(false);
  });

  /** @scenario "AC200 Sources: each query shows its sources as pills, and the card names them" */
  it("is empty for a widget with no query, so the card shows no footer", () => {
    expect(widgetSourcesLine([])).toBe("");
  });

  /** @scenario "AC204 Sources: SQL that does not read the parameter counts every origin and says so" */
  it("says all sources when no query reads the parameter, whatever the lists store", () => {
    expect(widgetSourcesLine([query("a", ["application"], IGNORES)])).toBe("Sources: all sources");
    expect(picksNoSources([query("a", [], IGNORES)])).toBe(false);
  });

  /** @scenario "AC202f Stock widgets: a widget that reads a view with no origin says that sources do not apply" */
  it("says sources do not apply when every view the widget reads keeps no origin", () => {
    expect(widgetSourcesLine([query("a", ["application"], NO_ORIGIN)])).toBe(
      "Sources don't apply: this widget reads a view that keeps no origin",
    );
  });
});
