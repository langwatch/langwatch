/**
 * The draft one widget hands Langy: a question in the reader's words, with the widget, its
 * stored prompt, its queries cut to fit and the period's instants in the widget's context.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  boardSubject,
  widgetAskDraft,
  widgetBuildQuestion,
  widgetMissingDataDraft,
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

const SQL = "SELECT count() FROM trace_metrics_by_minute";

describe("widgetPromptDraft", () => {
  describe("given a widget with a stored prompt, a description and named queries", () => {
    /**
     * @scenario "AC121 Ask Langy: clicking drafts the widget's prompt with its name, queries and the period"
     * @scenario "AC247 Langy drafts: the visible draft is in the reader's words, the queries ride in the context"
     */
    it("drafts a short opener, with the board and the widget chip attached", () => {
      const request = widgetPromptDraft({
        widget: { id: "widget-1", ...widget({ prompt: PROMPT, description: "Requests per day" }) },
        board: BOARD,
        period: PERIOD,
      });

      expect(request.question).toBeUndefined();
      expect(request.draft).toBe("Hey Langy, about the Traffic chart: ");
      expect(request.context).toEqual([
        expect.objectContaining({ kind: "dashboard", label: "Weekly review" }),
        expect.objectContaining({ kind: "widget", label: "widget: Traffic" }),
      ]);
      const ref = request.context[1]?.ref ?? "";
      expect(ref).toContain('widget "Traffic" (id widget-1)');
      expect(ref).toContain('on dashboard "Weekly review" (id board-1)');
      expect(ref).toContain("description: Requests per day");
      expect(ref).toContain(`how to answer it: ${PROMPT}`);
      expect(ref).toContain("period: 2026-09-01T00:00:00Z to 2026-09-08T00:00:00Z");
      expect(ref).toContain(`queries (LangWatchQL): series: ${SQL}`);
    });

    /** @scenario "AC121c Ask Langy: the widget rides as a widget chip, its queries never in the text" */
    it("keeps the query out of the draft text, whatever the query holds", () => {
      const request = widgetPromptDraft({
        widget: widget({ prompt: PROMPT }),
        board: BOARD,
        period: PERIOD,
      });

      expect(request.draft).not.toContain(SQL);
      expect(request.draft).not.toMatch(/SELECT|LangWatchQL|FROM /);
    });
  });

  describe("given a query with a comment line and spaces inside a literal", () => {
    /** @scenario "AC121 Ask Langy: clicking drafts the widget's prompt with its name, queries and the period" */
    it("hands Langy the query without its comment, keeping the literal's spaces", () => {
      const sql = "SELECT 'a  b' AS label -- why\nFROM trace_metrics";
      const request = widgetPromptDraft({
        widget: widget({ queries: [{ name: "main", sql: `  ${sql}\n` }] }),
        board: BOARD,
        period: PERIOD,
      });

      expect(request.context[1]?.ref).toContain(
        "main: SELECT 'a  b' AS label  \nFROM trace_metrics",
      );
      expect(request.context[1]?.ref).not.toContain("-- why");
    });

    /** @scenario "AC121 Ask Langy: clicking drafts the widget's prompt with its name, queries and the period" */
    it("keeps the second query whole when the first ends in a line comment", () => {
      const request = widgetPromptDraft({
        widget: widget({
          queries: [
            { name: "first", sql: "SELECT 1 -- count them" },
            { name: "second", sql: "SELECT 'two' FROM trace_metrics" },
          ],
        }),
        board: BOARD,
        period: PERIOD,
      });

      expect(request.context[1]?.ref).toContain("second: SELECT 'two' FROM trace_metrics");
    });
  });

  describe("given a widget whose queries are longer than its context allows", () => {
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

      const ref = request.context[1]?.ref ?? "";
      expect(ref.length).toBeLessThanOrEqual(4_000);
      expect(ref).toContain("short: SELECT 1 |");
      expect(ref).toMatch(/-- \[truncated: \d+ more characters\]/);
    });
  });

  describe("given a widget saved without a prompt", () => {
    /** @scenario "AC122 Ask Langy: a widget without a stored prompt gets a fallback" */
    it("drafts the same opener, and the widget chip carries no stored prompt", () => {
      const request = widgetPromptDraft({ widget: widget({}), board: BOARD, period: PERIOD });

      expect(request.draft).toBe("Hey Langy, about the Traffic chart: ");
      expect(request.context[1]?.ref).not.toContain("how to answer it");
      expect(request.context[1]?.ref).not.toContain("description:");
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
      expect(request.draft).not.toContain(SQL);
      expect(request.context).toEqual([
        expect.objectContaining({ kind: "dashboard", label: "Weekly review" }),
        expect.objectContaining({ label: "widget: Traffic" }),
      ]);
      expect(request.context[1]?.ref).toContain(SQL);
    });
  });
});

describe("widgetMissingDataDraft", () => {
  describe("given a widget whose traces lack a field it reads", () => {
    /** @scenario "Missing data: Ask Langy to help drafts how to send the missing field" */
    it("drafts how to send that field, then the widget and the window, about the board", () => {
      const request = widgetMissingDataDraft({
        missing: { field: "metadata.user_id", label: "user ids" },
        widget: widget({ prompt: PROMPT }),
        board: BOARD,
        period: PERIOD,
      });

      expect(request.question).toBeUndefined();
      expect(request.draft?.startsWith("Help me send user ids on my traces.")).toBe(true);
      expect(request.draft).toContain("metadata.user_id");
      expect(request.draft).not.toContain(SQL);
      expect(request.about).toEqual({ ref: "board-1" });
      expect(request.context).toEqual([
        expect.objectContaining({ kind: "dashboard", label: "Weekly review" }),
        expect.objectContaining({ label: "widget: Traffic" }),
      ]);
    });
  });
});

describe("editor drafts and starting prompts", () => {
  /** @scenario "Widget editor: Edit with Langy sends Langy its starting prompt about that widget" */
  it("sends the edit of a saved widget as a question, with the widget attached", () => {
    const request = widgetBuildQuestion({
      widget: { id: "w-1", ...widget({}) },
      board: BOARD,
      period: PERIOD,
    });

    expect(request.draft).toBeUndefined();
    expect(request.question?.startsWith('Edit my "Traffic" widget on my "Weekly review"')).toBe(
      true,
    );
    expect(request.question).not.toContain(SQL);
    expect(request.context).toEqual([
      expect.objectContaining({ kind: "dashboard", label: "Traffic" }),
      expect.objectContaining({ kind: "widget", label: "widget: Traffic" }),
    ]);
    expect(request.context[0]?.ref).toContain('widget "Traffic" (id w-1)');
  });

  /** @scenario "Widget editor: building a new widget with Langy sends Langy a starting prompt" */
  it("sends a new widget's starting prompt: the board, what is on it, and what to show", () => {
    const request = widgetBuildQuestion({ widget: widget({}), board: BOARD, period: PERIOD });

    expect(request.draft).toBeUndefined();
    expect(request.question).toContain(
      'I am building a new widget on my "Weekly review" dashboard, which already shows: Traffic.',
    );
    expect(request.question).toContain("Ask me what I want this widget to show");
    expect(request.question).toContain("save it only when I agree");
    expect(request.question).not.toContain("SELECT");
    expect(request.context).toHaveLength(1);
    expect(request.context[0]?.ref).toContain("not saved yet");
    expect(request.context[0]?.ref).toContain('dashboard "Weekly review" (id board-1)');
  });

  /** @scenario "Widget editor: Langy's suggestions fit the widget's shape" */
  it("drafts a picked suggestion about the widget, or about the new one being made", () => {
    const ask = { ask: "Show the top 10", why: "Keep the ten largest, fold the rest." };
    const saved = widgetAskDraft({
      ask,
      widget: { id: "w-1", ...widget({}) },
      board: BOARD,
      period: PERIOD,
    });
    const fresh = widgetAskDraft({ ask, widget: widget({}), board: BOARD, period: PERIOD });

    expect(saved.draft?.startsWith('For "Traffic": Show the top 10.')).toBe(true);
    expect(saved.about).toEqual({ ref: "board-1", itemRef: "w-1" });
    expect(fresh.draft?.startsWith("Show the top 10. Build it as a new widget")).toBe(true);
    expect(fresh.about).toEqual({ ref: "board-1", itemRef: "new" });
  });
});
