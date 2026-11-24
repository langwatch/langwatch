/**
 * The ask helpers every clickable chart carries: a mark is a named, keyboard-reachable button
 * with a pointer only while the host takes asks, and Enter, Space and a click all ask.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { describe, expect, it } from "vitest";

import { CATALOGUE_WIDGET_ACTIONS } from "../../catalogue/model/catalogue-widget-actions.ts";
import { CATALOGUE_WIDGET_BUILDS } from "../../catalogue/widgets/index.ts";
import { ASK_CODE, TABLE, TRACE_LINK, widgetCode } from "../model/widget-code-parts.ts";

interface Subject {
  kind?: string;
  label: string;
  value?: string;
  at?: string;
}
interface AskProps {
  role?: string;
  tabIndex?: number;
  "aria-label"?: string;
  onClick?: () => void;
  onKeyDown?: (event: { key: string; preventDefault: () => void }) => void;
}
interface Helpers {
  askable: (subject: Subject) => AskProps;
  askCursor: () => { cursor?: string };
  askableRow: (ask: ((row: unknown) => Subject | null) | undefined, row: unknown) => AskProps;
  signalProblem: (problem: unknown) => void;
}

function helpersOver({ canAskLangy }: { canAskLangy: boolean }) {
  const asked: Subject[] = [];
  const signals: unknown[] = [];
  const LW = {
    dashboardContext: { canAskLangy },
    askLangy: (subject: Subject) => asked.push(subject),
    signal: (state: unknown) => signals.push(state),
  };
  // askableRow is plain JS inside the Table part; the rest of the part is JSX.
  const row = TABLE.slice(TABLE.indexOf("function askableRow"), TABLE.indexOf("const mono"));
  // The stored snippets are what the frame runs; evaluating them is the test.
  // oxlint-disable-next-line no-implied-eval
  const helpers = new Function(
    "LW",
    `${ASK_CODE}\n${row}\nreturn { askable, askCursor, askableRow, signalProblem };`,
  )(LW) as Helpers;
  return { helpers, asked, signals };
}

describe("the chart ask helpers", () => {
  describe("given the host takes asks", () => {
    /** @scenario "AC124b Chart asks: a clickable bar is a keyboard-reachable button with a name" */
    it("makes a mark a focusable button named Ask Langy about its category, with a pointer", () => {
      const { helpers } = helpersOver({ canAskLangy: true });
      const props = helpers.askable({ label: "gpt-5" });

      expect(props.role).toBe("button");
      expect(props.tabIndex).toBe(0);
      expect(props["aria-label"]).toBe("Ask Langy about gpt-5");
      expect(helpers.askCursor()).toEqual({ cursor: "pointer" });
    });

    /** @scenario "AC124b Chart asks: a clickable bar is a keyboard-reachable button with a name" */
    it("asks on a click, Enter and Space, and ignores other keys", () => {
      const { helpers, asked } = helpersOver({ canAskLangy: true });
      const props = helpers.askable({ label: "errors", at: "Nov 3" });
      const press = (key: string) => props.onKeyDown?.({ key, preventDefault: () => undefined });

      props.onClick?.();
      press("Enter");
      press(" ");
      press("Tab");

      expect(asked).toEqual([
        { label: "errors", at: "Nov 3" },
        { label: "errors", at: "Nov 3" },
        { label: "errors", at: "Nov 3" },
      ]);
    });
  });

  describe("given the host does not take asks", () => {
    /** @scenario "AC124c Chart asks: a chart with nothing to investigate offers no click" */
    it("leaves a mark plain, with no role, handler or pointer", () => {
      const { helpers } = helpersOver({ canAskLangy: false });

      expect(helpers.askable({ label: "gpt-5" })).toEqual({});
      expect(helpers.askCursor()).toEqual({});
    });
  });
});

describe("a table row", () => {
  /** @scenario "AC246 Chart asks: a table row is a button that asks Langy about that row" */
  it("is a named button that asks about the row's kind and value, and plain without ask", () => {
    const { helpers, asked } = helpersOver({ canAskLangy: true });
    const ask = (row: unknown) => {
      const { model } = row as { model: string };
      return { kind: "model", label: model, value: `openai/${model}` };
    };
    const props = helpers.askableRow(ask, { model: "gpt-5" });

    props.onKeyDown?.({ key: "Enter", preventDefault: () => undefined });
    props.onClick?.();

    expect(props.role).toBe("button");
    expect(props["aria-label"]).toBe("Ask Langy about gpt-5");
    expect(asked).toEqual([
      { kind: "model", label: "gpt-5", value: "openai/gpt-5" },
      { kind: "model", label: "gpt-5", value: "openai/gpt-5" },
    ]);
    expect(helpers.askableRow(undefined, { model: "gpt-5" })).toEqual({});
    expect(helpers.askableRow(() => null, { model: "gpt-5" })).toEqual({});
  });

  /** @scenario "AC246 Chart asks: a table row is a button that asks Langy about that row" */
  it("draws each row through askableRow, and a request link inside stops its click", () => {
    expect(TABLE).toContain("{...askableRow(ask, row)}");
    expect(TRACE_LINK).toContain("event.stopPropagation()");
  });
});

describe("the problem signal", () => {
  /** @scenario "AC244 Widget actions: Investigate and Propose a fix show only while the widget reports its problem" */
  it("hands the frame a plain boolean, whatever the widget passes", () => {
    const { helpers, signals } = helpersOver({ canAskLangy: false });

    helpers.signalProblem(true);
    helpers.signalProblem(0);

    expect(signals).toEqual([{ problem: true }, { problem: false }]);
  });

  /** @scenario "AC244 Widget actions: Investigate and Propose a fix show only while the widget reports its problem" */
  it("clears the problem when a draw returns before it signals, such as an empty period", () => {
    const { tsx } = widgetCode({
      summary: "Test",
      subtitle: "Test",
      parts: [],
      queries: ["main"],
      body: "  if (main.data.length === 0) return null;\n  signalProblem(true);\n  return null;",
    });
    const widget = tsx.slice(tsx.indexOf("export default function Widget"));

    expect(widget).toContain("problemSignalled = false;");
    expect(widget).toContain("if (!problemSignalled) signalProblem(false);");
    expect(widget.indexOf("if (main.data.length === 0) return null;")).toBeGreaterThan(
      widget.indexOf("const drawn = (() => {"),
    );
  });
});

/** Declared click kinds no card offers yet, each with why. */
const CLICKS_NOT_OFFERED: Readonly<Record<string, string>> = {
  "ship-compare/run": "runs are column headers, which a table row cannot ask about",
  "ext-precision-recall/run": "a point in time sends a day, never a run",
  "voice-cost-per-call/part": "only the model part is charted",
};

/** Widgets with a problem button whose data cannot tell the problem; the button never shows. */
const PROBLEMS_NOT_SIGNALLED: Readonly<Record<string, string>> = {
  "fd-cost-efficiency": "no earlier period to tell cost per request rose",
  "ship-suites": "no time split to tell a suite's pass rate fell",
  "fd-coding-agents": "no per-agent cost or errors over time",
  "cost-by-model": "no traffic share to weigh the cost share against",
};

describe("the catalogue widgets with Langy prompts", () => {
  const built = Object.entries(CATALOGUE_WIDGET_ACTIONS).flatMap(([id, actions]) => {
    const build = CATALOGUE_WIDGET_BUILDS[id];
    return build ? [{ id, actions, code: build.code.tsx }] : [];
  });

  /** @scenario "AC245 Chart asks: a click says what kind of value was clicked, its raw value and the bucket it starts" */
  it("send every kind of value they declare a click prompt for", () => {
    const missing = built.flatMap(({ id, actions, code }) =>
      actions.flatMap((action) => {
        if (action.kind !== "click" || CLICKS_NOT_OFFERED[`${id}/${action.on}`]) return [];
        const sent =
          action.on === "day"
            ? /<SeriesChart|<MarkedChart|kind: "day"/.test(code)
            : code.includes(`"${action.on}"`);
        return sent ? [] : [`${id}/${action.on}`];
      }),
    );

    expect(missing).toEqual([]);
  });

  /** @scenario "AC244 Widget actions: Investigate and Propose a fix show only while the widget reports its problem" */
  it("signal their problem when they declare a button shown only while it is on the card", () => {
    const body = (code: string) => code.slice(code.indexOf("const signalProblem") + 20);
    const silent = built.flatMap(({ id, actions, code }) => {
      const needs = actions.some((action) => action.kind !== "click" && action.shown === "problem");
      return needs && !PROBLEMS_NOT_SIGNALLED[id] && !body(code).includes("signalProblem(")
        ? [id]
        : [];
    });

    expect(silent).toEqual([]);
  });
});
