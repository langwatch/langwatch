/**
 * The draft one widget hands Langy: its prompt or a fallback, the widget itself and the
 * board's window, with long LangWatchQL cut to fit.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  boardSubject,
  MAX_WIDGET_DRAFT_LENGTH,
  widgetPromptDraft,
  widgetSetupDraft,
} from "../model/board-langy.ts";

const PERIOD = {
  periodStart: Temporal.Instant.from("2026-09-01T00:00:00Z").epochMilliseconds,
  periodEnd: Temporal.Instant.from("2026-09-08T00:00:00Z").epochMilliseconds,
  granularitySeconds: 86_400 as const,
};
const BOARD = boardSubject({
  board: { id: "board-1", name: "Weekly review" },
  widgets: [{ name: "Traffic" }],
});
const PROMPT = "How much traffic did my agent get? Quote the real numbers.";

const widget = ({
  prompt,
  description,
  queries = [{ name: "series", sql: "SELECT count() FROM trace_metrics_by_minute" }],
}: {
  prompt?: string;
  description?: string;
  queries?: { name: string; sql: string }[];
}) => ({
  name: "Traffic",
  definition: {
    ...(prompt === undefined ? {} : { prompt }),
    ...(description === undefined ? {} : { description }),
    queries,
  },
});

describe("widgetPromptDraft", () => {
  describe("given a widget with a stored prompt, a description and named queries", () => {
    /** @scenario "AC121 Ask Langy: clicking drafts the widget's prompt with its name, queries and the period" */
    it("drafts the prompt, then the widget, then the window, with the board attached", () => {
      const request = widgetPromptDraft({
        widget: widget({ prompt: PROMPT, description: "Traces per bucket" }),
        board: BOARD,
        period: PERIOD,
      });

      expect(request.question).toBeUndefined();
      expect(request.draft).toBe(
        [
          PROMPT,
          "",
          "This widget:",
          "Name: Traffic",
          "Description: Traces per bucket",
          "Queries (LangWatchQL):",
          "- series:",
          "SELECT count() FROM trace_metrics_by_minute",
          "",
          "Dashboard period: 2026-09-01T00:00:00Z to 2026-09-08T00:00:00Z (UTC). " +
            "Dashboard grain: one bucket per 1 day.",
        ].join("\n"),
      );
      expect(request.context).toEqual([
        expect.objectContaining({ kind: "dashboard", label: "Weekly review" }),
      ]);
    });
  });

  describe("given a widget whose queries are longer than the draft allows", () => {
    /** @scenario "AC121 Ask Langy: clicking drafts the widget's prompt with its name, queries and the period" */
    it("cuts the long query with a marker, keeps the short one whole and stays in bounds", () => {
      const long = `SELECT ${"x, ".repeat(5_000)}1`;
      const request = widgetPromptDraft({
        widget: widget({
          prompt: PROMPT,
          queries: [
            { name: "short", sql: "SELECT 1" },
            { name: "long", sql: long },
          ],
        }),
        board: BOARD,
        period: PERIOD,
      });

      expect(request.draft?.length).toBeLessThanOrEqual(MAX_WIDGET_DRAFT_LENGTH);
      expect(request.draft).toContain("- short:\nSELECT 1\n");
      expect(request.draft).toMatch(/-- \[truncated: \d+ more characters\]/);
      expect(request.draft).toContain("Dashboard period:");
    });
  });

  describe("given a widget saved without a prompt", () => {
    /** @scenario "AC122 Ask Langy: a widget without a stored prompt gets a fallback" */
    it("starts with a prompt to answer the widget's name and quote the real numbers", () => {
      const request = widgetPromptDraft({ widget: widget({}), board: BOARD, period: PERIOD });

      expect(request.draft).toMatch(/^Answer "Traffic" for this dashboard widget/);
      expect(request.draft).toContain("Quote the real numbers");
      expect(request.draft).toContain("Name: Traffic");
      expect(request.draft).not.toContain("Description:");
    });
  });
});

describe("widgetSetupDraft", () => {
  describe.each([
    ["alert", 'Set up an alert on my "Traffic" dashboard widget.'],
    ["report", 'Send my "Traffic" dashboard widget as a scheduled report.'],
  ] as const)("given the member picks the %s action", (setup, opening) => {
    /**
     * @scenario "AC142 Widget menu: Set an alert drafts Langy to alert on that widget"
     * @scenario "AC143 Widget menu: Send as a report drafts Langy to schedule that widget"
     */
    it("drafts what to set up, then the widget and the window, with the board attached", () => {
      const request = widgetSetupDraft({
        setup,
        widget: widget({ prompt: PROMPT }),
        board: BOARD,
        period: PERIOD,
      });

      expect(request.question).toBeUndefined();
      expect(request.draft?.startsWith(opening)).toBe(true);
      expect(request.draft).not.toContain(PROMPT);
      expect(request.draft).toContain("Name: Traffic");
      expect(request.draft).toContain("SELECT count() FROM trace_metrics_by_minute");
      expect(request.draft).toContain("Dashboard period:");
      expect(request.context).toEqual([
        expect.objectContaining({ kind: "dashboard", label: "Weekly review" }),
      ]);
    });
  });
});
