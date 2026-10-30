/**
 * The product events Dashboards sends: their names once the host composes them, and the
 * attributes each carries, none of them an id of a person or any SQL.
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */
import type { UiAnalyticsEvent } from "@langwatch/browser-host/analytics";
import { langyQuestionAsked } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import {
  dashboardCreated,
  dashboardDeleted,
  dashboardFavourited,
  dashboardViewed,
  langyTracesToggled,
  widgetAdded,
  widgetDeleted,
  widgetEdited,
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

  /** @scenario "Telemetry: asking Langy from a board sends langy.asked.question with where it was asked" */
  it("names a Langy ask by where it was asked, never by its text", () => {
    const event = langyQuestionAsked({ surface: "add_widget" });
    expect(composed(event)).toBe("langy.asked.question");
    expect(event.attributes).toEqual({ surface: "add_widget" });
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
});
