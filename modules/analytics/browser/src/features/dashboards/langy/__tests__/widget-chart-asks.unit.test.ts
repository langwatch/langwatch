/**
 * What a chart click and a widget action hand Langy: a draft about exactly that category,
 * series or action, then the widget and the board's window; and which widgets declare actions.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { CATALOGUE_WIDGETS, catalogueWidgetActions } from "../../catalogue/index.ts";
import {
  boardSubject,
  WIDGET_ACTIONS,
  widgetActionDraft,
  widgetActionLabel,
  widgetChartDraft,
} from "../model/board-langy.ts";

const PERIOD = {
  periodStart: Temporal.Instant.from("2026-09-01T00:00:00Z").epochMilliseconds,
  periodEnd: Temporal.Instant.from("2026-09-08T00:00:00Z").epochMilliseconds,
  granularitySeconds: 86_400 as const,
};
const BOARD = boardSubject({
  board: { id: "board-1", name: "Weekly review" },
  widgets: [{ name: "Errors per day" }],
});
const SQL = "SELECT count() FROM trace_metrics_by_minute";
const WIDGET = {
  name: "Errors per day",
  definition: { queries: [{ name: "series", sql: SQL }] },
};
const WINDOW =
  "Dashboard period: 2026-09-01T00:00:00Z to 2026-09-08T00:00:00Z (UTC). " +
  "Dashboard grain: one bucket per 1 day.";

describe("widgetChartDraft", () => {
  describe("given a clicked category", () => {
    /** @scenario "AC124 Chart asks: clicking a bar or a point drafts Langy about that category and the period" */
    it("drafts an investigation of that category over the period, then the widget and window", () => {
      const request = widgetChartDraft({
        subject: { label: "gpt-5" },
        widget: WIDGET,
        board: BOARD,
        period: PERIOD,
      });

      expect(request.question).toBeUndefined();
      expect(
        request.draft?.startsWith(
          'Investigate "gpt-5" over the dashboard period in my "Errors per day" dashboard widget.',
        ),
      ).toBe(true);
      expect(request.draft).toContain(
        `Name: Errors per day\nQueries (LangWatchQL):\n- series:\n${SQL}`,
      );
      expect(request.draft?.endsWith(WINDOW)).toBe(true);
      expect(request.about).toEqual({ ref: "board-1" });
      expect(request.context[0]).toMatchObject({ kind: "dashboard", label: "Weekly review" });
    });
  });

  describe("given a series clicked at one bucket", () => {
    /** @scenario "AC124 Chart asks: clicking a bar or a point drafts Langy about that category and the period" */
    it("names the series and the bucket", () => {
      const request = widgetChartDraft({
        subject: { label: "Errors", at: "Sep 3" },
        widget: WIDGET,
        board: BOARD,
        period: PERIOD,
      });

      expect(
        request.draft?.startsWith(
          'Investigate "Errors" at Sep 3 in my "Errors per day" dashboard widget.',
        ),
      ).toBe(true);
    });
  });
});

describe("widgetActionDraft", () => {
  /** @scenario "AC125b Widget actions: each action drafts its own prompt about the widget" */
  it.each([
    ["investigate", "Investigate", 'Investigate what my "Errors per day" dashboard widget shows'],
    ["propose-fix", "Propose a fix", 'Propose a fix for the worst problem my "Errors per day"'],
    ["fill-gaps", "Fill the gaps", 'My "Errors per day" dashboard widget shows gaps'],
  ] as const)(
    "drafts %s as its own prompt, then the widget and window",
    (action, label, opening) => {
      const request = widgetActionDraft({ action, widget: WIDGET, board: BOARD, period: PERIOD });

      expect(widgetActionLabel(action)).toBe(label);
      expect(request.question).toBeUndefined();
      expect(request.draft?.startsWith(opening)).toBe(true);
      expect(request.draft).toContain(`- series:\n${SQL}`);
      expect(request.draft?.endsWith(WINDOW)).toBe(true);
    },
  );

  /** @scenario "AC125b Widget actions: each action drafts its own prompt about the widget" */
  it("asks Langy to change nothing until the member agrees on a proposed fix", () => {
    const request = widgetActionDraft({
      action: "propose-fix",
      widget: WIDGET,
      board: BOARD,
      period: PERIOD,
    });

    expect(request.draft).toContain("change nothing until I agree");
  });
});

describe("the actions catalogue widgets declare", () => {
  /** @scenario "AC125 Widget actions: a problem widget offers its declared actions under the chart" */
  it("gives failures, test suites and evaluator widgets Investigate and Propose a fix", () => {
    for (const id of ["fd-failures", "up-errors", "ship-suites", "lowest-passing-evaluators"]) {
      expect(catalogueWidgetActions(id)).toEqual(["investigate", "propose-fix"]);
    }
  });

  /** @scenario "AC125 Widget actions: a problem widget offers its declared actions under the chart" */
  it("gives missing-data widgets Investigate and Fill the gaps", () => {
    expect(catalogueWidgetActions("cost-accuracy")).toEqual(["investigate", "fill-gaps"]);
  });

  /** @scenario "AC125c Widget actions: a widget that declares no actions shows no action row" */
  it("gives a widget that declares none, an unknown id and no id no actions", () => {
    expect(catalogueWidgetActions("traffic")).toEqual([]);
    expect(catalogueWidgetActions("no-such-widget")).toEqual([]);
    expect(catalogueWidgetActions(undefined)).toEqual([]);
  });

  /** @scenario "AC125 Widget actions: a problem widget offers its declared actions under the chart" */
  it("declares only known actions, each at most once", () => {
    for (const widget of CATALOGUE_WIDGETS) {
      const actions = widget.actions ?? [];
      expect(new Set(actions).size).toBe(actions.length);
      for (const action of actions) expect(WIDGET_ACTIONS).toContain(action);
    }
  });
});
