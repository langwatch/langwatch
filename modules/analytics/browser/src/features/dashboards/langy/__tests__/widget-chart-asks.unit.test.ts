/**
 * What a chart click and a widget action hand Langy: the widget's own prompt for that action or
 * kind of value in the reader's words, with the widget and its queries in the context; and
 * which buttons a card shows while its widget reports a problem.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { CATALOGUE_WIDGETS, catalogueWidgetActions } from "../../catalogue/index.ts";
import { CATALOGUE_WIDGET_ACTIONS } from "../../catalogue/model/catalogue-widget-actions.ts";
import {
  boardSubject,
  shownWidgetButtons,
  type WidgetAction,
  type WidgetButtonAction,
  type WidgetClickAction,
  widgetActionDraft,
  widgetActionLabel,
  widgetChartDraft,
  widgetClickFor,
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
const INVESTIGATE: WidgetButtonAction = {
  kind: "investigate",
  shown: "problem",
  prompt: '"{question}" shows more errors over {period}. Show me 3 requests.',
};
const FIX: WidgetButtonAction = {
  kind: "propose-fix",
  label: "Add prices",
  shown: "always",
  prompt: '"{question}" misses prices over {period}; change nothing until I agree.',
};
const DAY_CLICK: WidgetClickAction = {
  kind: "click",
  on: "day",
  prompt: 'On "{question}", what errors happened on {day}?',
};
const OUTCOME_CLICK: WidgetClickAction = {
  kind: "click",
  on: "day",
  series: "outcome",
  prompt: 'On "{question}", why did {outcome} change on {day}?',
};
const MODEL_CLICK: WidgetClickAction = {
  kind: "click",
  on: "model",
  prompt: 'On "{question}", what does {model} cost over {period}?',
};

describe("widgetChartDraft", () => {
  describe("given a clicked value the widget declares no prompt for", () => {
    /** @scenario "AC124 Chart asks: clicking a bar or a point drafts Langy about that category and the period" */
    it("drafts a question about that value over the period, with the widget attached", () => {
      const request = widgetChartDraft({
        subject: { kind: "model", label: "gpt-5" },
        widget: WIDGET,
        board: BOARD,
        period: PERIOD,
      });

      expect(request.question).toBeUndefined();
      expect(request.draft).toMatch(
        /^On "Errors per day", what stands out about the model "gpt-5" over the last 7 days\?/,
      );
      expect(request.about).toEqual({ ref: "board-1" });
      expect(request.context[0]).toMatchObject({ kind: "dashboard", label: "Weekly review" });
      expect(request.context[1]).toMatchObject({ label: "widget: Errors per day" });
      expect(request.context[1]?.ref).toContain(`series: ${SQL}`);
    });
  });

  describe("given a value clicked at one bucket, with no prompt declared for it", () => {
    /** @scenario "AC124 Chart asks: clicking a bar or a point drafts Langy about that category and the period" */
    it("names the value beside the bucket", () => {
      const request = widgetChartDraft({
        subject: { kind: "model", label: "gpt-5", at: "2026-09-03T00:00:00Z" },
        widget: WIDGET,
        board: BOARD,
        period: PERIOD,
      });

      expect(request.draft).toMatch(/what stands out about the model "gpt-5" on /);
    });
  });

  describe("given a day clicked with the series under the pointer", () => {
    /** @scenario "AC124 Chart asks: clicking a bar or a point drafts Langy about that category and the period" */
    it("names the series and the day in words", () => {
      const request = widgetChartDraft({
        subject: { kind: "day", label: "Sep 3", at: "2026-09-03T00:00:00.000Z", series: "Errors" },
        widget: WIDGET,
        board: BOARD,
        period: PERIOD,
      });

      expect(request.draft).toMatch(
        /^On "Errors per day", what stands out about Errors on 3 September 2026\?/,
      );
    });
  });

  describe("given the widget declares a prompt for the kind clicked", () => {
    /** @scenario "AC243 Widget actions: each catalogue widget asks Langy its own question for each action and each kind of value" */
    it("fills the day, the value and the period into the widget's own prompt", () => {
      const day = widgetChartDraft({
        subject: { kind: "day", label: "Sep 3", at: "2026-09-03T00:00:00.000Z" },
        click: DAY_CLICK,
        widget: WIDGET,
        board: BOARD,
        period: PERIOD,
      });
      const model = widgetChartDraft({
        subject: { kind: "model", label: "gpt-5", value: "openai/gpt-5" },
        click: MODEL_CLICK,
        widget: WIDGET,
        board: BOARD,
        period: PERIOD,
      });

      expect(day.draft).toBe('On "Errors per day", what errors happened on 3 September 2026?');
      expect(model.draft).toBe('On "Errors per day", what does gpt-5 cost over the last 7 days?');
    });

    /** @scenario "AC243 Widget actions: each catalogue widget asks Langy its own question for each action and each kind of value" */
    it("fills the series under the pointer, and falls back when the click names none", () => {
      const at = "2026-09-03T00:00:00.000Z";
      const withSeries = widgetChartDraft({
        subject: { kind: "day", label: "Sep 3", at, series: "Refused" },
        click: OUTCOME_CLICK,
        widget: WIDGET,
        board: BOARD,
        period: PERIOD,
      });
      const without = widgetChartDraft({
        subject: { kind: "day", label: "Sep 3", at },
        click: OUTCOME_CLICK,
        widget: WIDGET,
        board: BOARD,
        period: PERIOD,
      });

      expect(withSeries.draft).toBe(
        'On "Errors per day", why did Refused change on 3 September 2026?',
      );
      expect(without.draft).not.toContain("{");
      expect(without.draft).toContain("3 September 2026");
    });

    /** @scenario "AC243 Widget actions: each catalogue widget asks Langy its own question for each action and each kind of value" */
    it("picks the click prompt by the kind the frame sends, in any case", () => {
      const actions: WidgetAction[] = [INVESTIGATE, DAY_CLICK, MODEL_CLICK];

      expect(widgetClickFor({ actions, subject: { kind: "Model", label: "gpt-5" } })).toBe(
        MODEL_CLICK,
      );
      expect(widgetClickFor({ actions, subject: { kind: "topic", label: "x" } })).toBeUndefined();
      expect(widgetClickFor({ actions, subject: { label: "x" } })).toBeUndefined();
    });
  });

  /** @scenario "AC245 Chart asks: a click says what kind of value was clicked, its raw value and the bucket it starts" */
  it("hands Langy the raw value and the bucket's start beside the draft", () => {
    const request = widgetChartDraft({
      subject: { kind: "model", label: "gpt-5", value: "openai/gpt-5", at: "2026-09-03T00:00:00Z" },
      click: MODEL_CLICK,
      widget: WIDGET,
      board: BOARD,
      period: PERIOD,
    });

    expect(request.draft).not.toContain("openai/gpt-5");
    expect(request.context[1]?.ref).toContain(
      'clicked: model "gpt-5", raw value openai/gpt-5, bucket starting 2026-09-03T00:00:00Z',
    );
  });
});

describe("widgetActionDraft", () => {
  /** @scenario "AC125b Widget actions: each action drafts its own prompt about the widget" */
  it("drafts the widget's own prompt for the button, with its title and period in words", () => {
    const request = widgetActionDraft({
      action: INVESTIGATE,
      widget: WIDGET,
      board: BOARD,
      period: PERIOD,
    });

    expect(widgetActionLabel(INVESTIGATE)).toBe("Investigate");
    expect(widgetActionLabel(FIX)).toBe("Add prices");
    expect(request.question).toBeUndefined();
    expect(request.draft).toBe(
      '"Errors per day" shows more errors over the last 7 days. Show me 3 requests.',
    );
    expect(request.context[1]?.ref).toContain(`series: ${SQL}`);
  });

  /** @scenario "AC125b Widget actions: each action drafts its own prompt about the widget" */
  it("asks Langy to change nothing until the member agrees on every proposed fix", () => {
    const fixes = Object.values(CATALOGUE_WIDGET_ACTIONS)
      .flat()
      .filter((action) => action.kind === "propose-fix");

    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes.filter(({ prompt }) => !/change nothing until I agree/i.test(prompt))).toEqual([]);
  });
});

describe("the buttons a card shows", () => {
  /** @scenario "AC244 Widget actions: Investigate and Propose a fix show only while the widget reports its problem" */
  it("shows problem buttons only while the widget reports its problem, and always ones always", () => {
    const actions: WidgetAction[] = [INVESTIGATE, FIX, DAY_CLICK];

    expect(shownWidgetButtons({ actions, problem: true })).toEqual([INVESTIGATE, FIX]);
    expect(shownWidgetButtons({ actions, problem: false })).toEqual([FIX]);
  });
});

describe("the actions catalogue widgets declare", () => {
  /** @scenario "AC125 Widget actions: a problem widget offers its declared actions under the chart" */
  it("gives failures, test suites and evaluator widgets Investigate and Propose a fix", () => {
    for (const id of ["fd-failures", "up-errors", "lowest-passing-evaluators"]) {
      const kinds = catalogueWidgetActions(id).map((action) => action.kind);
      expect(kinds).toEqual(expect.arrayContaining(["investigate", "propose-fix"]));
    }
  });

  /** @scenario "AC125 Widget actions: a problem widget offers its declared actions under the chart" */
  it("names the one fix a widget proposes on its button", () => {
    const labels = (id: string) =>
      shownWidgetButtons({ actions: catalogueWidgetActions(id), problem: true }).map(
        widgetActionLabel,
      );

    expect(labels("data-health")).toEqual(["Fill the gaps"]);
    expect(labels("cost-accuracy")).toEqual(["Add prices"]);
  });

  /** @scenario "AC125c Widget actions: a widget that declares no actions shows no action row" */
  it("gives a ranking widget no buttons, and an unknown id or no id nothing at all", () => {
    expect(
      shownWidgetButtons({ actions: catalogueWidgetActions("top-models"), problem: true }),
    ).toEqual([]);
    expect(catalogueWidgetActions("no-such-widget")).toEqual([]);
    expect(catalogueWidgetActions(undefined)).toEqual([]);
    expect(catalogueWidgetActions("constructor")).toEqual([]);
    expect(catalogueWidgetActions("__proto__")).toEqual([]);
  });

  /** @scenario "AC243 Widget actions: each catalogue widget asks Langy its own question for each action and each kind of value" */
  it("declares prompts only for catalogue widgets, each naming the widget's question", () => {
    const ids = new Set(CATALOGUE_WIDGETS.map(({ id }) => id));
    for (const [id, actions] of Object.entries(CATALOGUE_WIDGET_ACTIONS)) {
      expect(ids.has(id), id).toBe(true);
      for (const action of actions) expect(action.prompt, id).toContain('"{question}"');
    }
  });

  /** @scenario "AC243 Widget actions: each catalogue widget asks Langy its own question for each action and each kind of value" */
  it("keeps every prompt in the reader's words: no em dash and no query language", () => {
    const emDash = String.fromCodePoint(0x2014);
    const banned = /LangWatchQL|LWQL|\bSELECT\b|uniqExact|TraceId|\btraces?\b/;
    for (const [id, actions] of Object.entries(CATALOGUE_WIDGET_ACTIONS)) {
      for (const action of actions) {
        const visible = action.prompt.replace(/"\{question\}"/g, "");
        expect(visible, id).not.toMatch(banned);
        expect(visible, id).not.toContain(emDash);
      }
    }
  });

  /** @scenario "AC243 Widget actions: each catalogue widget asks Langy its own question for each action and each kind of value" */
  it("declares one prompt per kind of value clicked", () => {
    for (const [id, actions] of Object.entries(CATALOGUE_WIDGET_ACTIONS)) {
      const kinds = actions.flatMap((action) =>
        action.kind === "click"
          ? [`${action.on}/${action.series ?? ""}/${action.value ?? ""}`]
          : [action.kind],
      );
      expect(new Set(kinds).size, id).toBe(kinds.length);
    }
  });
});
