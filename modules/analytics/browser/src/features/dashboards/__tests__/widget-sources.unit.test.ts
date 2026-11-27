/**
 * What a widget's card says about its queries' sources, and when it has none to count.
 * @see modules/dashboard/specs/dashboards-v2.feature AC200, AC200m, AC202i, AC213, AC240
 */

import { TRACE_SOURCES } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { cardLimitMessages } from "../../dashboard-widget/behavior/use-dashboard-widget-executor.ts";
import {
  picksNoSources,
  runSources,
  widgetCardFooter,
  widgetCardSourcesLine,
  widgetProjectsLine,
  widgetSourcesLine,
} from "../model/widget-sources.ts";

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

  /** @scenario "AC202f Stock widgets: a widget that reads a view with no origin stores no sources and its editor says they do not apply" */
  it("says sources do not apply when every view the widget reads keeps no origin", () => {
    expect(widgetSourcesLine([query("a", ["application"], NO_ORIGIN)])).toBe(
      "Sources don't apply: this widget reads a view that keeps no origin",
    );
  });
});

describe("widgetCardSourcesLine", () => {
  describe("when every query counts only the default source", () => {
    /** @scenario "AC240 Card sources line: a widget counting only the default application source shows no sources line" */
    it("shows no line, whether the list is stored or left unset", () => {
      expect(widgetCardSourcesLine([query("main")])).toBe("");
      expect(widgetCardSourcesLine([query("a", ["application"]), query("b")])).toBe("");
    });
  });

  describe("when every view the widget reads keeps no origin", () => {
    /** @scenario "AC240b Card sources line: a widget whose views keep no origin shows no sources line" */
    it("shows no line", () => {
      expect(widgetCardSourcesLine([query("a", ["application"], NO_ORIGIN)])).toBe("");
    });
  });

  describe("when the sources change how the figures read", () => {
    /** @scenario "AC240c Card sources line: a widget counting more or other sources than the default names them" */
    it("names them in plain words, each query's own list, everything or none picked", () => {
      expect(widgetCardSourcesLine([query("a", ["application", "gateway"])])).toBe(
        "Counts: your app and the AI gateway",
      );
      expect(widgetCardSourcesLine([query("a", ["application", "langy", "simulation"])])).toBe(
        "Counts: your app, Langy and simulated tests",
      );
      expect(widgetCardSourcesLine([query("a", ["langy"])])).toBe("Counts: Langy");
      expect(widgetCardSourcesLine([query("a"), query("b", ["langy"])])).toBe(
        "Counts: a: your app · b: Langy",
      );
      expect(widgetCardSourcesLine([query("a", ["application"], IGNORES)])).toBe(
        "Counts everything, tests included.",
      );
      expect(widgetCardSourcesLine([query("a", [...TRACE_SOURCES])])).toBe(
        "Counts everything, tests included.",
      );
      expect(widgetCardSourcesLine([query("a", [])])).toBe("Pick at least one source.");
      expect(
        widgetCardSourcesLine([query("a", ["application"]), query("b", void 0, IGNORES)]),
      ).toBe("Counts: a: your app · b: everything");
    });
  });
});

describe("widgetCardFooter", () => {
  /** @scenario "AC213 Diagnostics: a card shows what the server limited as one (i) line" */
  it("adds one (i) line of the limiting messages, and none when the run was not limited", () => {
    const message = "Some projects share data only from a date, so earlier rows are not included";

    const footer = { sourcesLine: "Sources: application", projectsLine: "", spanFloor: "" };

    expect(widgetCardFooter({ ...footer, limits: message })).toBe(
      `Sources: application \u00b7 \u24d8 ${message}`,
    );
    expect(widgetCardFooter({ ...footer, limits: "" })).toBe("Sources: application");
    expect(message).not.toMatch(/project-|\d/);
  });

  /** @scenario "AC216 Change markers" */
  it("puts where span data starts in the footer, before the (i) line", () => {
    expect(
      widgetCardFooter({
        sourcesLine: "Sources: application",
        projectsLine: "",
        spanFloor: "Span data from 10 Oct 2026",
        limits: "",
      }),
    ).toBe("Sources: application \u00b7 Span data from 10 Oct 2026");
  });
});

describe("runSources", () => {
  /** @scenario "AC202i Stock widgets: a query over views with no origin raises no note that sources were ignored" */
  it("names no sources for a query over views with no origin, or the presence query", () => {
    expect(runSources(query("modelCosts", ["application"], NO_ORIGIN))).toBeNull();
    expect(runSources(query("present", ["application"], IGNORES))).toBeNull();
  });

  /** @scenario "AC203 Sources: a query reading the parameter is kept to the list it stores" */
  it("keeps the list of a query someone named present that reads the parameter", () => {
    const own = query("present", ["application", "langy"]);

    expect(runSources(own)).toEqual(["application", "langy"]);
    expect(widgetSourcesLine([own])).toBe("Sources: application, langy");
    expect(picksNoSources([query("present", [])])).toBe(true);
  });

  /** @scenario "AC202i Stock widgets: a query over views with no origin raises no note that sources were ignored" */
  it("names what a query over an origin view stores, and null when it stores none", () => {
    expect(runSources(query("main", ["application", "langy"]))).toEqual(["application", "langy"]);
    expect(runSources(query("main", ["application"], IGNORES))).toEqual(["application"]);
    expect(runSources(query("main"))).toBeNull();
  });
});

describe("cardLimitMessages", () => {
  const shareWindow = {
    code: "SHARE_WINDOW_LIMITED",
    message: "Some projects share data only from a date, so earlier rows are not included",
  };
  const sourcesIgnored = {
    code: "SOURCES_IGNORED",
    message: "This query doesn't read {dashboard_context_sources}, so it counts every origin.",
  };

  /** @scenario "AC213 Diagnostics: a card shows what the server limited as one (i) line" */
  it("keeps the diagnostics that say the server limited the run", () => {
    expect(cardLimitMessages([shareWindow])).toEqual([shareWindow.message]);
  });

  /** @scenario "AC213b Diagnostics: a card leaves SOURCES_IGNORED to its sources line" */
  it("leaves SOURCES_IGNORED to the sources line, so no footer shows the placeholder", () => {
    const footer = widgetCardFooter({
      sourcesLine: widgetSourcesLine([query("a", ["application"], IGNORES)]),
      projectsLine: "Project: Alpha",
      spanFloor: "",
      limits: cardLimitMessages([sourcesIgnored]).join(" "),
    });

    expect(cardLimitMessages([sourcesIgnored])).toEqual([]);
    expect(footer).toBe("Sources: all sources \u00b7 Project: Alpha");
    expect(footer).not.toContain("{dashboard_context_sources}");
  });

  /** @scenario "AC213c Sources line: a view named with its database still keeps its origin" */
  it("reads the view behind any database qualifier", () => {
    for (const view of ["langwatch.trace_metrics", "analytics.trace_metrics"]) {
      const line = widgetSourcesLine([query("a", null, `SELECT count() FROM ${view}`)]);

      expect(line).toBe("Sources: all sources");
    }
  });
});

describe("widgetProjectsLine", () => {
  const readable = [
    { id: "shop", name: "Shop" },
    { id: "ops", name: "Ops" },
  ];
  const stores = (projects?: string[]) => [{ projects }];

  /** @scenario "A widget's card names its projects only where they differ from the board's" */
  it("names no project where the widget reads what the board reads", () => {
    for (const queries of [stores(), stores(["shop"])]) {
      expect(widgetProjectsLine({ queries, boardProjectId: "shop", readable })).toBe("");
    }
  });

  /** @scenario "A widget's card names its projects only where they differ from the board's" */
  it("names the projects a widget reads beside or instead of the board's", () => {
    const line = (projects: string[]) =>
      widgetProjectsLine({ queries: stores(projects), boardProjectId: "shop", readable });

    expect(line(["ops"])).toBe("Project: Ops");
    expect(line(["shop", "ops"])).toBe("Projects: Shop, Ops");
  });

  /** @scenario "A widget's card names its projects only where they differ from the board's" */
  it("on a board reading every project, names projects only where the query stores some", () => {
    const line = (projects?: string[]) =>
      widgetProjectsLine({ queries: stores(projects), boardProjectId: null, readable });

    expect(line()).toBe("");
    expect(line(["shop"])).toBe("Project: Shop");
  });
});
