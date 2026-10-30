/**
 * The product events Dashboards sends: their names once the host composes them, and the
 * attributes each carries, none of them an id of a person or any SQL.
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */
import type { UiAnalyticsEvent } from "@langwatch/browser-host/analytics";
import { describe, expect, it } from "vitest";

import {
  dashboardCreated,
  dashboardDeleted,
  dashboardEdited,
  dashboardFavourited,
  dashboardKey,
  dashboardViewed,
  editorOpened,
  langyAsked,
  langyTracesToggled,
  periodChanged,
  queryRan,
  widgetAdded,
  widgetDeleted,
  widgetEdited,
  widgetExported,
  widgetViewed,
} from "../dashboard-usage-events.ts";

/** The name every destination receives: `boundary.action.name`, as the host composes it. */
const composed = (event: UiAnalyticsEvent) =>
  [event.boundary, event.action, event.name].filter(Boolean).join(".");

describe("the Dashboards product events", () => {
  /** @scenario "Telemetry: opening a board sends dashboards.viewed.dashboard" */
  it("names a board view and carries its kind, its widget count and its template", () => {
    const event = dashboardViewed({ dashboardKind: "curated", widgetCount: 6, templateId: "cost" });

    expect(composed(event)).toBe("dashboards.viewed.dashboard");
    expect(event.attributes).toEqual({
      dashboardKind: "curated",
      widgetCount: 6,
      templateId: "cost",
    });
    expect(dashboardViewed({ dashboardKind: "stored", widgetCount: 0 }).attributes).toEqual({
      dashboardKind: "stored",
      widgetCount: 0,
    });
  });

  /** @scenario "Telemetry: making a board sends dashboards.created.dashboard with where it came from" */
  it("names a board made and where it came from", () => {
    expect(composed(dashboardCreated({ createdFrom: "blank" }))).toBe(
      "dashboards.created.dashboard",
    );
    expect(dashboardCreated({ createdFrom: "template", templateId: "cost" }).attributes).toEqual({
      createdFrom: "template",
      templateId: "cost",
    });
  });

  /** @scenario "Telemetry: adding, saving and deleting a widget each send their own event" */
  it("names a widget added, edited and deleted", () => {
    expect(composed(widgetAdded({ addedFrom: "catalogue", widgetCount: 2 }))).toBe(
      "dashboards.added.widget",
    );
    expect(widgetAdded({ addedFrom: "editor" }).attributes).toEqual({
      addedFrom: "editor",
      widgetCount: 1,
    });
    expect(composed(widgetEdited())).toBe("dashboards.edited.widget");
    expect(composed(widgetDeleted())).toBe("dashboards.deleted.widget");
  });

  /** @scenario "Telemetry: deleting a board sends dashboards.deleted.dashboard" */
  it("names a board deleted", () => {
    expect(composed(dashboardDeleted())).toBe("dashboards.deleted.dashboard");
  });

  /** @scenario "Telemetry: asking Langy from a board sends dashboards.asked.langy" */
  it("names a Langy ask", () => {
    expect(composed(langyAsked())).toBe("dashboards.asked.langy");
  });

  /** @scenario "Telemetry: starring a board sends dashboards.favourited.dashboard" */
  it("names a star and whether it was put on or taken off", () => {
    expect(composed(dashboardFavourited({ starred: true }))).toBe(
      "dashboards.favourited.dashboard",
    );
    expect(dashboardFavourited({ starred: false }).attributes).toEqual({ starred: false });
  });

  describe("given a widget saved with its sources", () => {
    type Saved = Parameters<typeof langyTracesToggled>[0]["after"];
    const application: Saved = [{ sources: ["application"] }];
    const withLangy: Saved = [{ sources: ["application", "langy"] }];
    const storingNone: Saved = [{ sources: null }];

    /** @scenario "Telemetry: changing whether a widget counts Langy traces sends dashboards.toggled.langy_traces" */
    it("sends a toggle when Langy's traces are added or taken away", () => {
      const added = langyTracesToggled({ before: application, after: withLangy });
      expect(added && composed(added)).toBe("dashboards.toggled.langy_traces");
      expect(added?.attributes).toEqual({ included: true });
      expect(langyTracesToggled({ before: withLangy, after: storingNone })?.attributes).toEqual({
        included: false,
      });
    });

    /** @scenario "Telemetry: changing whether a widget counts Langy traces sends dashboards.toggled.langy_traces" */
    it("sends none when the save leaves Langy's traces as they were", () => {
      expect(langyTracesToggled({ before: application, after: storingNone })).toBeUndefined();
      expect(langyTracesToggled({ before: withLangy, after: withLangy })).toBeUndefined();
    });
  });

  describe("when a member uses a board after opening it", () => {
    /** @scenario "Telemetry: a board view carries a one-way board key, never the board id" */
    it("gives a board one stable 16-hex key that is not its id", async () => {
      const key = await dashboardKey("dashboard_abc123");

      expect(key).toMatch(/^[0-9a-f]{16}$/);
      expect(await dashboardKey("dashboard_abc123")).toBe(key);
      expect(await dashboardKey("dashboard_other")).not.toBe(key);
      expect(key).not.toContain("abc123");
      expect(
        dashboardViewed({ dashboardKind: "stored", widgetCount: 2, dashboardKey: key }).attributes,
      ).toEqual({ dashboardKind: "stored", widgetCount: 2, dashboardKey: key });
    });

    /** @scenario "Telemetry: a widget on screen sends dashboards.viewed.widget once per board view" */
    it("names a widget seen and where it came from", () => {
      const event = widgetViewed({ widgetSource: "langy" });

      expect(composed(event)).toBe("dashboards.viewed.widget");
      expect(event.attributes).toEqual({ widgetSource: "langy" });
    });

    /** @scenario "Telemetry: picking a board period sends dashboards.changed.period" */
    it("names a period picked with its range and grain", () => {
      const event = periodChanged({ range: "7d", grain: "1h" });

      expect(composed(event)).toBe("dashboards.changed.period");
      expect(event.attributes).toEqual({ range: "7d", grain: "1h" });
    });

    /** @scenario "Telemetry: exporting a widget sends dashboards.exported.widget" */
    it("names a widget exported and its format", () => {
      const event = widgetExported({ format: "csv" });

      expect(composed(event)).toBe("dashboards.exported.widget");
      expect(event.attributes).toEqual({ format: "csv" });
    });

    /** @scenario "Telemetry: renaming a board or saving its layout sends dashboards.edited.dashboard" */
    it("names a board edit and what changed", () => {
      expect(composed(dashboardEdited({ change: "rename" }))).toBe("dashboards.edited.dashboard");
      expect(dashboardEdited({ change: "layout" }).attributes).toEqual({ change: "layout" });
    });

    /** @scenario "Telemetry: opening the widget editor sends lwql.opened.editor" */
    it("names the editor opened on a new or saved widget", () => {
      const event = editorOpened({ widgetIs: "new" });

      expect(composed(event)).toBe("lwql.opened.editor");
      expect(event.attributes).toEqual({ widgetIs: "new" });
    });

    /** @scenario "Telemetry: running a query in the widget editor sends lwql.ran.query" */
    it("names a query run and carries nothing about the query", () => {
      const event = queryRan();

      expect(composed(event)).toBe("lwql.ran.query");
      expect(event.attributes).toEqual({});
    });
  });
});
