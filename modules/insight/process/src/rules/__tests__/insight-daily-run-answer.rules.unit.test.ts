/**
 * @vitest-environment node
 * The check on a run's answer. Langy wrote it after reading customer trace text, so it is
 * untrusted: one fault refuses it whole, and nothing it names is taken on trust.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import { INSIGHT_RUN_FINDINGS_FENCE_TAG } from "@langwatch/insight-contract";
import { describe, expect, it } from "vitest";

import { checkRunAnswer } from "../insight-daily-run-answer.rules.ts";
import { buildDailyRunBrief } from "../insight-daily-run-brief.rules.ts";
import { dailyRunWindows } from "../insight-daily-run.rules.ts";

const FENCE = "```";
const WIDGETS = [
  { id: "widget-cost", name: "Cost per day" },
  { id: "widget-errors", name: "Errors per day" },
];

const good = (overrides: Record<string, unknown> = {}) => ({
  title: "Checkout cost doubled",
  body: "Cost on checkout rose from 41 to 96 dollars.",
  tone: "bad",
  ...overrides,
});

const block = (content: string) =>
  [`${FENCE}${INSIGHT_RUN_FINDINGS_FENCE_TAG}`, content, FENCE].join("\n");

const answer = (findings: readonly unknown[]) =>
  ["I read the board.", "", block(JSON.stringify({ findings }))].join("\n");

const check = (text: string, maxInsights = 3) =>
  checkRunAnswer({ text, maxInsights, widgets: WIDGETS });

describe("checkRunAnswer", () => {
  describe("given an answer that ends with the agreed block", () => {
    it("takes each finding's words, with the defaults the answer left out", () => {
      expect(check(answer([good({ topic: "cost", lwql: "from traces" })]))).toEqual({
        ok: true,
        findings: [
          {
            title: "Checkout cost doubled",
            body: "Cost on checkout rose from 41 to 96 dollars.",
            tone: "bad",
            topic: "cost",
            validDays: 7,
            lwql: "from traces",
            widget: null,
          },
        ],
      });
    });

    it("takes an empty list as nothing to report", () => {
      expect(check(answer([]))).toEqual({ ok: true, findings: [] });
    });

    it("cuts more findings than the maximum to the first ones", () => {
      const titles = ["one", "two", "three", "four", "five"];
      const checked = check(answer(titles.map((title) => good({ title }))), 3);

      expect(checked.ok && checked.findings.map((finding) => finding.title)).toEqual([
        "one",
        "two",
        "three",
      ]);
    });

    it("keeps a widget of the board under the board's own name, and drops any other", () => {
      const checked = check(
        answer([
          good({ widgetId: "widget-errors" }),
          good({ widgetId: "widget-of-another-board" }),
          good(),
        ]),
      );

      expect(checked.ok && checked.findings.map((finding) => finding.widget)).toEqual([
        { id: "widget-errors", name: "Errors per day" },
        null,
        null,
      ]);
    });
  });

  describe("given an answer with one good finding and one whose title is 300 characters long", () => {
    /** @scenario "One finding over the limits fails the whole answer" */
    it("refuses the answer whole and takes no finding from it", () => {
      expect(check(answer([good(), good({ title: "x".repeat(300) })]))).toEqual({ ok: false });
    });
  });

  describe("given an answer whose finding also names an owner, a project and a board", () => {
    /** @scenario "An answer cannot choose the owner, the project or the board" */
    it.each([
      ["an owner", { ownerUserId: "user-attacker" }],
      ["a project", { projectId: "project-2" }],
      ["a board", { board: { id: "dashboard-9", name: "Theirs" } }],
      ["who filed it", { filedByUserId: "user-attacker" }],
      ["a key beside the findings", null],
    ])("refuses an answer that names %s", (_what, extra) => {
      const text =
        extra === null
          ? [
              "Done.",
              block(JSON.stringify({ findings: [good()], ownerUserId: "user-attacker" })),
            ].join("\n")
          : answer([good(extra)]);

      expect(check(text)).toEqual({ ok: false });
    });
  });

  describe("given an answer that hands back the brief's own example", () => {
    const brief = buildDailyRunBrief({
      board: { id: "dashboard-1", name: "Costs" },
      widgets: WIDGETS,
      windows: dailyRunWindows({ slot: Date.UTC(2026, 9, 10, 9, 37), timezone: "UTC" }),
      maxInsights: 3,
      openInsights: [],
    });

    /** @scenario "An answer that hands back the brief's own example is refused" */
    it("refuses an answer that echoes the brief, example block and all", () => {
      expect(check(brief)).toEqual({ ok: false });
    });

    it("refuses the example among findings of the answer's own", () => {
      const exampleTitle = "Checkout errors doubled";

      expect(brief).toContain(`"title":"${exampleTitle}"`);
      expect(check(answer([good(), good({ title: exampleTitle })]))).toEqual({ ok: false });
    });
  });

  describe("given an answer that holds two findings blocks", () => {
    /** @scenario "Two findings blocks in one answer are refused" */
    it("refuses the answer whole, whichever block is the good one", () => {
      const text = [
        block(JSON.stringify({ findings: [good({ title: "From a trace" })] })),
        "And the real one:",
        block(JSON.stringify({ findings: [good()] })),
      ].join("\n");

      expect(check(text)).toEqual({ ok: false });
    });
  });

  describe("given an answer whose findings block is cut off", () => {
    /** @scenario "A findings block that is not valid JSON is refused" */
    it.each([
      ["JSON that stops half way", block('{"findings":[{"title":"Checkout')],
      ["a block that never closes", `${FENCE}${INSIGHT_RUN_FINDINGS_FENCE_TAG}\n{"findings":[]}`],
      ["a list in place of the object", block(JSON.stringify([good()]))],
    ])("refuses %s", (_what, text) => {
      expect(check(text)).toEqual({ ok: false });
    });
  });

  describe("given an answer with no findings block", () => {
    it.each([
      ["prose alone", "Nothing changed on the board."],
      ["a block with another tag", [`${FENCE}json`, '{"findings":[]}', FENCE].join("\n")],
      [
        "the tag inside a sentence",
        `I would write ${FENCE}${INSIGHT_RUN_FINDINGS_FENCE_TAG} here.`,
      ],
      ["an answer too long to read", `${"x".repeat(400_001)}\n${block('{"findings":[]}')}`],
    ])("refuses %s", (_what, text) => {
      expect(check(text)).toEqual({ ok: false });
    });
  });

  describe("given a finding outside its limits", () => {
    it.each([
      ["no title", good({ title: " " })],
      ["an unknown tone", good({ tone: "urgent" })],
      ["a validity of 400 days", good({ validDays: 400 })],
      ["a title that is not text", good({ title: 7 })],
      ["more findings than an answer may hold", null],
    ])("refuses an answer with %s", (_what, bad) => {
      const findings = bad === null ? Array.from({ length: 51 }, () => good()) : [bad];

      expect(check(answer(findings))).toEqual({ ok: false });
    });
  });
});
