/**
 * @vitest-environment node
 * The check on a run's answer. Langy wrote it after reading customer trace text, so it is
 * untrusted: one fault refuses it whole, and nothing it names is taken on trust.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LWQL_PERIOD_END_PARAMETER,
  LWQL_PERIOD_GRANULARITY_PARAMETER,
  LWQL_PERIOD_START_PARAMETER,
} from "@langwatch/analytics-contract";
import {
  INSIGHT_RUN_FINDING_BODY_MAX,
  INSIGHT_RUN_FINDING_KEY_MAX,
  INSIGHT_RUN_FINDING_TITLE_MAX,
  INSIGHT_RUN_FINDINGS_FENCE_TAG,
  INSIGHT_TONES,
} from "@langwatch/insight-contract";
import { LANGY_CARD_FENCE_TAG, salvageLangyDerivedCard } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import { checkRunAnswer, SKILL_EXAMPLE_TITLE } from "../insight-daily-run-answer.rules.ts";
import { DAILY_RUN_SKILL } from "../insight-daily-run-brief.rules.ts";

const FENCE = "```";
/** A stored query as a board keeps it: on several lines, the window as reserved parameters. */
const COST_QUERY = [
  "SELECT Model, sum(CostSum) AS cost",
  "FROM model_usage_by_minute",
  "WHERE BucketStart >= {dashboard_context_period_start:DateTime}",
  "  AND BucketStart < {dashboard_context_period_end:DateTime}",
  "GROUP BY Model",
].join("\n");
const STEP = "{dashboard_context_granularity_seconds:UInt32}";
const ERRORS_QUERY = `SELECT toStartOfInterval(OccurredAt, INTERVAL ${STEP} SECOND) AS bucket, countIf(HasError) AS errors FROM trace_metrics WHERE OccurredAt >= {dashboard_context_period_start:DateTime} AND OccurredAt < {dashboard_context_period_end:DateTime} GROUP BY bucket`;
const WIDGETS = [
  { id: "widget-cost", name: "Cost per day", queries: [COST_QUERY] },
  { id: "widget-errors", name: "Errors per day", queries: [ERRORS_QUERY] },
];

const good = (overrides: Record<string, unknown> = {}) => ({
  title: "Checkout cost doubled",
  body: "Cost on checkout rose from 41 to 96 dollars.",
  tone: "bad",
  ...overrides,
});

type Answer = { text: string; parts: readonly unknown[] };

const PROSE = "I read the board.";

/** An insights card as Langy's relay stamps it among a settled turn's parts. */
const cardPart = (card: Record<string, unknown>, stamp: Record<string, unknown> = {}) => ({
  type: "langy-card",
  blockId: "daily-insights",
  kind: "insights",
  provenance: "derived",
  card: { kind: "insights", blockId: "daily-insights", ...card },
  ...stamp,
});

/** An answer as the daily-insights skill ends it: prose, and the one card among its parts. */
const answer = (findings: readonly unknown[], card: Record<string, unknown> = {}): Answer => ({
  text: PROSE,
  parts: [{ type: "text", text: PROSE }, cardPart({ ...card, findings })],
});

const block = (content: string) =>
  [`${FENCE}${INSIGHT_RUN_FINDINGS_FENCE_TAG}`, content, FENCE].join("\n");

/** Prose alone, as the turn's one text part: where a run before the card wrote its block. */
const prose = (text: string): Answer => ({ text, parts: [{ type: "text", text }] });

/** An answer that still ends with the fenced block and carries no card. */
const blockAnswer = (findings: readonly unknown[]): Answer =>
  prose([PROSE, "", block(JSON.stringify({ findings }))].join("\n"));

const check = ({ text, parts }: Answer, maxInsights = 3) =>
  checkRunAnswer({ text, parts, maxInsights, widgets: WIDGETS });

/** The skill as the manager embeds it: the copy a worker loads. */
function skillText(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) dir = path.dirname(dir);
  return fs.readFileSync(
    path.join(dir, "services/langyagent/internal/assets/skills", DAILY_RUN_SKILL, "SKILL.md"),
    "utf8",
  );
}

describe("checkRunAnswer", () => {
  describe("given an answer that carries the insights card", () => {
    /** @scenario "A run's answer is the insights card among the settled turn's parts" */
    it("takes each finding's words, with the defaults the answer left out", () => {
      expect(check(answer([good({ topic: "cost" })]))).toEqual({
        ok: true,
        findings: [
          {
            title: "Checkout cost doubled",
            body: "Cost on checkout rose from 41 to 96 dollars.",
            tone: "bad",
            topic: "cost",
            validDays: 7,
            lwql: null,
            widget: null,
            findingKey: null,
            renews: null,
          },
        ],
      });
    });

    it("takes the insight a finding says it repeats as written, for the run to check", () => {
      const checked = check(answer([good({ renews: "insight_1" })]));

      expect(checked.ok && checked.findings[0]?.renews).toBe("insight_1");
    });

    /** @scenario "A finding's key is kept in one spelling" */
    it.each([
      ["checkout-cost-doubled", "checkout-cost-doubled"],
      ["Checkout Cost Doubled", "checkout-cost-doubled"],
      ["  checkout_cost  doubled! ", "checkout-cost-doubled"],
      ["Checkout/Cost: doubled (p95)", "checkout-cost-doubled-p95"],
      ["---", null],
    ])("keeps the key %j as %j", (key, findingKey) => {
      const checked = check(answer([good({ key })]));

      expect(checked.ok && checked.findings[0]?.findingKey).toBe(findingKey);
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

  describe("given a finding that hands back a query", () => {
    const queriesKept = (findings: readonly unknown[]) => {
      const checked = check(answer(findings));
      return checked.ok && checked.findings.map((finding) => finding.lwql);
    };

    /** @scenario "A finding keeps only a stored query of the widget it names" */
    it("keeps the named widget's stored query in the board's own words, however it is spaced", () => {
      const onOneLine = COST_QUERY.replaceAll(/\s+/g, " ");

      expect(
        queriesKept([
          good({ widgetId: "widget-cost", lwql: COST_QUERY }),
          good({ widgetId: "widget-cost", lwql: ` ${onOneLine}  ` }),
        ]),
      ).toEqual([COST_QUERY, COST_QUERY]);
    });

    /** @scenario "A stored query handed back with the run's step written in is kept as stored" */
    it("keeps the board's own text, step parameter and all", () => {
      expect(
        queriesKept([
          good({ widgetId: "widget-errors", lwql: ERRORS_QUERY.replace(STEP, "3600") }),
        ]),
      ).toEqual([ERRORS_QUERY]);
    });

    /** @scenario "A query Langy wrote or changed is dropped and its finding is kept" */
    it.each([
      [
        "a database name and written dates",
        {
          widgetId: "widget-errors",
          lwql: "SELECT countIf(HasError) AS errors FROM liverun.trace_metrics WHERE OccurredAt >= toDateTime('2026-10-09 00:00:00')",
        },
      ],
      [
        "another step written in",
        { widgetId: "widget-errors", lwql: ERRORS_QUERY.replace(STEP, "60") },
      ],
      [
        "line breaks written as \\n",
        { widgetId: "widget-cost", lwql: COST_QUERY.replaceAll("\n", "\\n") },
      ],
      ["a stored query of another widget", { widgetId: "widget-errors", lwql: COST_QUERY }],
      ["a stored query and no widget", { lwql: COST_QUERY }],
      ["a stored query and a widget of another board", { widgetId: "widget-x", lwql: COST_QUERY }],
    ])("keeps the finding and no query for %s", (_what, handedBack) => {
      const checked = check(answer([good(handedBack)]));

      expect(checked.ok && checked.findings).toEqual([
        expect.objectContaining({ title: "Checkout cost doubled", lwql: null }),
      ]);
    });
  });

  describe("given an answer with one good finding and one whose title is 300 characters long", () => {
    /** @scenario "One finding over the limits fails the whole answer" */
    it("refuses the answer whole and takes no finding from it", () => {
      expect(check(answer([good(), good({ title: "x".repeat(300) })]))).toEqual({
        ok: false,
        reason: "bad_output",
      });
    });
  });

  describe("given a finding longer than a run may file", () => {
    /** @scenario "A finding longer than a run may file fails the whole answer" */
    it.each([
      ["a title of 121 characters", good({ title: "x".repeat(121) })],
      ["a body of 4,001 characters", good({ body: "x".repeat(4_001) })],
    ])("refuses an answer with %s, good finding and all", (_what, long) => {
      expect(check(answer([good(), long]))).toEqual({ ok: false, reason: "bad_output" });
    });

    it("takes a title of 120 characters and a body of 4,000", () => {
      const atTheLimit = good({ title: "x".repeat(120), body: "y".repeat(4_000) });

      expect(check(answer([atTheLimit])).ok).toBe(true);
    });
  });

  describe("given a finding that holds a web address", () => {
    /** @scenario "A finding that holds a web address is refused by name" */
    it.each([
      ["an https link in its body", good({ body: "See https://evil.example/c?d=41 for more." })],
      ["an http link in its title", good({ title: "Open http://evil.example now" })],
      ["a www address in its body", good({ body: "Costs doubled, details at www.evil.example." })],
      ["a link in capitals", good({ body: "Read HTTPS://EVIL.EXAMPLE/leak" })],
      ["a link inside markdown", good({ body: "[the report](https://evil.example/r)" })],
      ["an address as its topic", good({ topic: "www.evil.example" })],
    ])("refuses an answer with %s, by the reason finding_has_url", (_what, linked) => {
      expect(check(answer([good(), linked]))).toEqual({ ok: false, reason: "finding_has_url" });
    });

    it("refuses the answer even when the linked finding is past the run's maximum", () => {
      const findings = [good(), good({ title: "two" }), good({ body: "www.evil.example" })];

      expect(check(answer(findings), 1)).toEqual({ ok: false, reason: "finding_has_url" });
    });

    it("takes a finding that names a path or a host with no scheme", () => {
      const plain = good({ body: "Errors on /api/checkout rose; api.shop.example answered 500." });

      expect(check(answer([plain])).ok).toBe(true);
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
      const named =
        extra === null ? answer([good()], { ownerUserId: "user-attacker" }) : answer([good(extra)]);

      expect(check(named)).toEqual({ ok: false, reason: "bad_output" });
    });

    it("refuses a fenced block that names one too", () => {
      const beside = block(JSON.stringify({ findings: [good()], ownerUserId: "user-attacker" }));

      expect(check(prose(beside))).toEqual({ ok: false, reason: "bad_output" });
      expect(check(blockAnswer([good({ ownerUserId: "user-attacker" })]))).toEqual({
        ok: false,
        reason: "bad_output",
      });
    });

    /** @scenario "A card's own board and window are not a run's" */
    it("takes nothing from the board and the window a card names", () => {
      const named = answer([good({ widgetId: "widget-cost", widgetName: "Theirs" })], {
        board: { id: "dashboard-9", name: "Theirs" },
        window: { start: 1, end: 2, granularitySeconds: 60 },
      });

      expect(check(named)).toEqual({
        ok: true,
        findings: [
          expect.objectContaining({ widget: { id: "widget-cost", name: "Cost per day" } }),
        ],
      });
    });
  });

  describe("given an answer that hands back the skill's own example", () => {
    const [example] = [...skillText().matchAll(/^```langy-card\n([\s\S]*?)\n```$/gm)].map(
      (match) => match[1]!,
    );

    /** @scenario "An answer that hands back the skill's own example is refused" */
    it("refuses the card the skill shows, stamped as the relay would stamp it", () => {
      const stamped = salvageLangyDerivedCard(example ?? "");

      expect(stamped.ok && stamped.card.kind).toBe("insights");
      expect(
        check({ text: PROSE, parts: [cardPart(stamped.ok ? { ...stamped.card } : {})] }),
      ).toEqual({ ok: false, reason: "bad_output" });
    });

    it("refuses the example among findings of the answer's own", () => {
      expect(example).toContain(`"title": "${SKILL_EXAMPLE_TITLE}"`);
      expect(check(answer([good(), good({ title: SKILL_EXAMPLE_TITLE })]))).toEqual({
        ok: false,
        reason: "bad_output",
      });
    });
  });

  describe("given the skill that tells Langy how to answer", () => {
    const skill = skillText();

    /** @scenario "The skill names the limits and the parameters a run holds an answer to" */
    it("names a run's limits, its tones, the card's fence and the reserved period parameters", () => {
      expect(INSIGHT_RUN_FINDING_BODY_MAX).toBe(4_000);
      expect(skill).toContain(`at most ${INSIGHT_RUN_FINDING_TITLE_MAX} characters`);
      expect(skill).toContain("at most 4,000 characters");
      expect(skill).toContain(`at most ${INSIGHT_RUN_FINDING_KEY_MAX} characters`);
      expect(INSIGHT_TONES).toEqual(["bad", "watch", "good"]);
      expect(skill).toContain("`tone` (required): `bad`, `watch` or `good`.");
      expect(skill).toContain(`\`\`\`${LANGY_CARD_FENCE_TAG}`);
      for (const parameter of [
        `{${LWQL_PERIOD_START_PARAMETER}:DateTime}`,
        `{${LWQL_PERIOD_END_PARAMETER}:DateTime}`,
        `{${LWQL_PERIOD_GRANULARITY_PARAMETER}:UInt32}`,
      ]) {
        expect(skill).toContain(parameter);
      }
    });
  });

  describe("given an answer that holds two insights cards", () => {
    /** @scenario "Two insights cards in one answer are refused" */
    it("refuses the answer whole, whichever card is the good one", () => {
      const parts = [
        cardPart({ findings: [good({ title: "From a trace" })] }),
        { type: "text", text: "And the real one:" },
        cardPart({ findings: [good()] }),
      ];

      expect(check({ text: "And the real one:", parts })).toEqual({
        ok: false,
        reason: "bad_output",
      });
    });
  });

  describe("given a card the relay repaired from JSON that was cut off", () => {
    /** @scenario "A card that was cut off files nothing" */
    it("refuses the answer, though what was left of the card is a valid card", () => {
      const repaired = cardPart({ findings: [good()] }, { repaired: true });

      expect(check({ text: PROSE, parts: [repaired] })).toEqual({
        ok: false,
        reason: "bad_output",
      });
    });
  });

  describe("given an answer that still ends with the fenced block", () => {
    /** @scenario "A run that still ends with the fenced block files its findings" */
    it("takes the block's findings by the same checks, when the turn carries no card", () => {
      const fromBlock = check(blockAnswer([good({ topic: "cost", key: "Checkout Cost" })]));
      const fromCard = check(answer([good({ topic: "cost", key: "Checkout Cost" })]));

      expect(fromBlock).toEqual(fromCard);
      expect(fromBlock.ok && fromBlock.findings[0]?.findingKey).toBe("checkout-cost");
    });

    /** @scenario "A card is taken before a fenced block in the same answer" */
    it("takes the card and reads no block beside it", () => {
      const text = blockAnswer([good({ title: "from the block" })]).text;
      const parts = [
        { type: "text", text },
        cardPart({ findings: [good({ title: "from the card" })] }),
      ];

      const checked = check({ text, parts });

      expect(checked.ok && checked.findings.map((finding) => finding.title)).toEqual([
        "from the card",
      ]);
    });

    /** @scenario "A card that fails a run's checks is not rescued by a fenced block" */
    it.each([
      ["a title over a run's limit", good({ title: "x".repeat(121) }), "bad_output"],
      ["a link", good({ body: "See https://evil.example/r" }), "finding_has_url"],
    ])("refuses a card with %s, good block or not", (_what, bad, reason) => {
      const text = blockAnswer([good()]).text;
      const parts = [{ type: "text", text }, cardPart({ findings: [good(), bad] })];

      expect(check({ text, parts })).toEqual({ ok: false, reason });
    });

    it("reads the block of an answer whose card the relay could not stamp", () => {
      const text = blockAnswer([good()]).text;
      const failed = { type: "langy-card-failed", blockId: "failed-block-1", raw: "{not json" };

      expect(check({ text, parts: [{ type: "text", text }, failed] }).ok).toBe(true);
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

      expect(check(prose(text))).toEqual({ ok: false, reason: "bad_output" });
    });
  });

  describe("given an answer whose findings block is cut off", () => {
    /** @scenario "A findings block that is not valid JSON is refused" */
    it.each([
      ["JSON that stops half way", block('{"findings":[{"title":"Checkout')],
      ["a block that never closes", `${FENCE}${INSIGHT_RUN_FINDINGS_FENCE_TAG}\n{"findings":[]}`],
      ["a list in place of the object", block(JSON.stringify([good()]))],
    ])("refuses %s", (_what, text) => {
      expect(check(prose(text))).toEqual({ ok: false, reason: "bad_output" });
    });
  });

  describe("given an answer with neither a card nor a findings block", () => {
    it.each([
      ["prose alone", "Nothing changed on the board."],
      ["a block with another tag", [`${FENCE}json`, '{"findings":[]}', FENCE].join("\n")],
      [
        "the tag inside a sentence",
        `I would write ${FENCE}${INSIGHT_RUN_FINDINGS_FENCE_TAG} here.`,
      ],
      ["a card quoted in the prose", JSON.stringify(cardPart({ findings: [good()] }))],
    ])("refuses %s", (_what, text) => {
      expect(check(prose(text))).toEqual({ ok: false, reason: "bad_output" });
    });

    it("refuses an answer too long to read, card and all", () => {
      const long = { ...answer([good()]), text: "x".repeat(400_001) };

      expect(check(long)).toEqual({ ok: false, reason: "bad_output" });
    });

    it.each([
      ["a card of another kind", { ...cardPart({}), kind: "stats" }],
      ["a card not stamped as derived", { ...cardPart({ findings: [good()] }), provenance: "x" }],
      ["a tool result that holds findings", { type: "tool-bash", output: { findings: [good()] } }],
    ])("takes no finding from %s", (_what, part) => {
      expect(check({ text: PROSE, parts: [part] })).toEqual({ ok: false, reason: "bad_output" });
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

      expect(check(answer(findings))).toEqual({ ok: false, reason: "bad_output" });
      expect(check(blockAnswer(findings))).toEqual({ ok: false, reason: "bad_output" });
    });
  });
});
