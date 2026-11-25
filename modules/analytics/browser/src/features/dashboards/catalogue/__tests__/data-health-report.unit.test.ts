/**
 * The data completeness card: each field over the requests it applies to, the chat rows only
 * for chat agents, the headline, and each gap's own Langy ask and links. The report is the
 * stored snippet the frame runs; evaluating it over fake query rows is the test.
 * @see modules/dashboard/specs/dashboards-v2.feature AC166b to AC166e
 */

import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { boardSubject, widgetChartDraft, widgetClickFor } from "../../langy/model/board-langy.ts";
import { NUMBERS } from "../../templates/model/widget-code-parts.ts";
import { CATALOGUE_WIDGET_ACTIONS } from "../model/catalogue-widget-actions.ts";
import { CATALOGUE_WIDGET_BUILDS } from "../widgets/index.ts";
import { HEALTH_FIELDS } from "../widgets/trust-queries.ts";
import { HEALTH_REPORT, SHARE_PCT } from "../widgets/trust-widgets-code.ts";

interface Ask {
  kind: string;
  value: string;
  label: string;
}
interface Row {
  key: string;
  label: string;
  group: "every" | "chat" | "optional";
  tone: "red" | "orange" | "green" | "optional";
  base: number;
  missing: number;
  value: number | null;
  note: string;
  ask: Ask | null;
  docs: boolean;
  example: string;
  priceModel: string;
}
interface Report {
  rows: Row[];
  headline: { title: string; line: string };
  shared: { line: string; example: string } | null;
  noCalls: string;
  problem: boolean;
}

const FIELDS = HEALTH_FIELDS.map(({ key, label }) => ({ key, label, unlocks: [] }));
// oxlint-disable-next-line no-implied-eval
const healthReport = new Function(
  `${NUMBERS}\n${SHARE_PCT}\nconst FIELDS = ${JSON.stringify(FIELDS)};\n${HEALTH_REPORT}\n` +
    "return healthReport;",
)() as (rows: unknown[], unpricedModel?: string) => Report | null;

type Counts = Partial<Record<string, [present: number, base: number, example?: string]>>;

/** The coverage query's rows: every field at 100% of 1,000 requests unless `counts` says. */
function coverage(counts: Counts = {}) {
  const total = counts.all?.[1] ?? 1000;
  const defaults: Counts = {
    all: [total, total],
    model: [total, total],
    cost: [total, total],
    no_tokens: [0, total],
    no_price: [0, total],
    conversation: [total, total],
    user: [total, total],
    labels: [total, total],
    outcome: [total, total],
    neither: [0, total],
  };
  return Object.entries({ ...defaults, ...counts }).map(([field, value]) => ({
    field,
    present: String(value?.[0]),
    base: String(value?.[1]),
    example: value?.[2] ?? "",
  }));
}

function reportOf(counts: Counts, unpricedModel?: string): Report {
  const report = healthReport(coverage(counts), unpricedModel);
  if (!report) throw new Error("no report");
  return report;
}

const rowOf = (report: Report, key: string) => {
  const row = report.rows.find((candidate) => candidate.key === key);
  if (!row) throw new Error(`no row ${key}`);
  return row;
};

describe("given the data completeness card", () => {
  describe("when some requests call no model", () => {
    /** @scenario "AC166b Data health: model name and cost count only the requests that call a model" */
    it("scores model name over the requests that call a model, never every request", () => {
      const report = reportOf({
        model: [2130, 2130],
        cost: [2020, 2130, "trace-9"],
        no_tokens: [80, 2130],
        no_price: [30, 2130],
        all: [3080, 3080],
        conversation: [3080, 3080],
        user: [3080, 3080],
        labels: [3080, 3080],
        outcome: [3080, 3080],
        neither: [0, 3080],
      });

      expect(rowOf(report, "model").tone).toBe("green");
      expect(rowOf(report, "cost").value).toBeCloseTo(2020 / 2130);
      expect(rowOf(report, "cost").note).toBe(
        "Cost is missing on 110 of 2,130 requests that call a model: 80 send no token " +
          "counts, 30 use a model with no price.",
      );
      expect(report.noCalls).toBe(
        "Requests that made no model call (950) are left out of these two rows.",
      );
    });

    /** @scenario "AC166b Data health: model name and cost count only the requests that call a model" */
    it("reads the requests that call a model and their cost from the views LangWatchQL serves", () => {
      const sql = CATALOGUE_WIDGET_BUILDS["data-health"]?.queries.fields ?? "";

      expect(sql).toContain("FROM span_metrics\n      WHERE SpanType = 'llm'");
      expect(sql).toContain("max(llm OR named) AS has_calls");
      expect(sql).toContain("toUInt8(TotalCost IS NOT NULL AND UnpricedSpanCount = 0) AS priced");
      expect(sql).toContain("toUInt8(UnpricedSpanCount > 0) AS unpriced");
      expect(sql).toContain("countIf(has_calls) AS calls_base");
      expect(sql).toContain("countIf(has_named) AS named_base");
      // A span row alone is no request of the period: the request's own row must be there.
      expect(sql).toContain("HAVING countIf(isTrace) > 0");
    });
  });

  describe("when no model is called at all", () => {
    /** @scenario "AC166b Data health: model name and cost count only the requests that call a model" */
    it("shows the two model rows as no model calls, never as a gap", () => {
      const report = reportOf({ model: [0, 0], cost: [0, 0], no_tokens: [0, 0], no_price: [0, 0] });

      expect(rowOf(report, "model").value).toBeNull();
      expect(rowOf(report, "model").tone).toBe("green");
      expect(report.problem).toBe(false);
    });
  });

  describe("when hardly any request carries a conversation or user id", () => {
    /** @scenario "AC166c Data health: conversation id and user id rows show only for chat agents" */
    it("moves both rows to the optional ones, never red", () => {
      const report = reportOf({ conversation: [20, 1000], user: [10, 1000] });

      expect(rowOf(report, "conversation").group).toBe("optional");
      expect(rowOf(report, "user").group).toBe("optional");
      expect(rowOf(report, "conversation").tone).toBe("optional");
      expect(rowOf(report, "user").note).toBe(
        "Send it to see who uses your agent and who comes back.",
      );
      expect(report.problem).toBe(false);
    });
  });

  describe("when 5% or more of requests carry a conversation id", () => {
    /** @scenario "AC166c Data health: conversation id and user id rows show only for chat agents" */
    it("scores both chat rows, red under 90%, orange from 90% and green from 99%", () => {
      const red = reportOf({ conversation: [50, 1000], user: [895, 1000] });
      const orange = reportOf({ conversation: [900, 1000], user: [989, 1000] });
      const green = reportOf({ conversation: [990, 1000] });

      expect(rowOf(red, "conversation").group).toBe("chat");
      expect(rowOf(red, "conversation").tone).toBe("red");
      expect(rowOf(red, "user").tone).toBe("red");
      expect(rowOf(orange, "conversation").tone).toBe("orange");
      expect(rowOf(orange, "user").tone).toBe("orange");
      expect(rowOf(green, "conversation").tone).toBe("green");
    });

    /** @scenario "AC166c Data health: conversation id and user id rows show only for chat agents" */
    it("keeps customer or labels and how it ended optional, never red", () => {
      const report = reportOf({ labels: [0, 1000], outcome: [0, 1000] });

      expect(rowOf(report, "labels").group).toBe("optional");
      expect(rowOf(report, "labels").tone).toBe("optional");
      expect(rowOf(report, "outcome").tone).toBe("optional");
      expect(report.problem).toBe(false);
    });
  });

  describe("when the card writes its headline", () => {
    /** @scenario "AC166d Data health: the headline names what is missing" */
    it("names one gap with its share", () => {
      const report = reportOf({ conversation: [690, 1000] });

      expect(report.headline.title).toBe(
        "Your agent does not send a conversation id on 31% of requests.",
      );
      expect(report.problem).toBe(true);
    });

    /** @scenario "AC166d Data health: the headline names what is missing" */
    it("names two or three gaps, and counts more than three", () => {
      const two = reportOf({ conversation: [690, 1000], user: [690, 1000] });
      const four = reportOf({
        model: [600, 1000],
        cost: [500, 600],
        conversation: [690, 1000],
        user: [700, 1000],
      });

      expect(two.headline.title).toBe("Conversation id and user id are missing on 31% of requests");
      expect(two.headline.line).toContain("Without them some cards are empty or count less.");
      expect(four.headline.title).toBe("Your agent's data is missing 4 things");
    });

    /** @scenario "AC166d Data health: the headline names what is missing" */
    it("says everything is sent, and counts the optional extras still missing", () => {
      const report = reportOf({ labels: [0, 1000], outcome: [100, 1000] });

      expect(report.headline.title).toBe("Your agent sends everything the dashboards need");
      expect(report.headline.line).toBe("Sending 2 optional extras would add more answers.");
    });

    /** @scenario "AC166d Data health: the headline names what is missing" */
    it("says once when the same requests carry neither id", () => {
      const report = reportOf({
        conversation: [690, 1000],
        user: [690, 1000],
        neither: [310, 1000, "trace-7"],
      });

      expect(report.shared).toEqual({
        example: "trace-7",
        line:
          "The same 31% of requests carry neither a conversation id nor a user id, which may " +
          "be a different part of your app.",
      });
      expect(reportOf({ conversation: [690, 1000], user: [690, 1000] }).shared).toBeNull();
    });

    /** @scenario "AC166d Data health: the headline names what is missing" */
    it("reports its problem from the stored code while a required row has a gap", () => {
      const code = CATALOGUE_WIDGET_BUILDS["data-health"]?.code.tsx ?? "";

      expect(code).toContain("signalProblem(report?.problem === true);");
    });
  });

  describe("when a field has a gap", () => {
    const period = {
      periodStart: Temporal.Instant.from("2026-09-01T00:00:00Z").epochMilliseconds,
      periodEnd: Temporal.Instant.from("2026-09-08T00:00:00Z").epochMilliseconds,
      granularitySeconds: 86_400 as const,
    };
    const widget = { name: "What is my agent not sending yet?", definition: { queries: [] } };
    const board = boardSubject({ board: { id: "board-1", name: "Trust" }, widgets: [widget] });
    const actions = CATALOGUE_WIDGET_ACTIONS["data-health"] ?? [];
    const draftOf = (ask: Ask) =>
      widgetChartDraft({
        subject: ask,
        click: widgetClickFor({ actions, subject: ask }),
        widget,
        board,
        period,
      }).draft;

    /** @scenario "AC166e Data health: each gap asks Langy its own question and links to the fix" */
    it("asks for the model name with the counts and the period", () => {
      const row = rowOf(reportOf({ model: [2010, 2130] }), "model");
      if (!row.ask) throw new Error("no ask");

      expect(row.ask).toEqual({
        kind: "field",
        value: "model",
        label: "120 of my agent's 2,130 requests that call a model",
      });
      expect(draftOf(row.ask)).toBe(
        'On "What is my agent not sending yet?", 120 of my agent\'s 2,130 requests that call ' +
          "a model in the last 7 days reach LangWatch without the model's name. Find where my " +
          "code calls the model and change the LangWatch setup so every model call records " +
          "which model it used. Propose the code change.",
      );
    });

    /** @scenario "AC166e Data health: each gap asks Langy its own question and links to the fix" */
    it("asks each field its own question", () => {
      const report = reportOf({
        cost: [900, 1000],
        no_tokens: [70, 1000],
        conversation: [600, 1000],
        user: [600, 1000],
        labels: [0, 1000],
        outcome: [0, 1000],
      });
      const drafts = ["cost", "conversation", "user", "labels", "outcome"].map((key) => {
        const ask = rowOf(report, key).ask;
        if (!ask) throw new Error(`no ask for ${key}`);
        return draftOf(ask);
      });

      expect(drafts[0]).toContain("70 of my agent's requests that call a model in the last 7");
      expect(drafts[0]).toContain("with no token counts");
      expect(drafts[1]).toContain("as the conversation id (thread_id) on every request");
      expect(drafts[2]).toContain("Send an id only, never a name or an email.");
      expect(drafts[3]).toContain("customer id (customer_id)");
      expect(drafts[4]).toContain("as the outcome on that conversation's last request");
    });

    /** @scenario "AC166e Data health: each gap asks Langy its own question and links to the fix" */
    it("offers the docs, a price for the unpriced model and an example request", () => {
      const report = reportOf(
        { cost: [970, 1000, "trace-3"], no_price: [30, 1000], conversation: [600, 1000, "t-1"] },
        "acme-small",
      );
      const code = CATALOGUE_WIDGET_BUILDS["data-health"]?.code.tsx ?? "";

      expect(rowOf(report, "cost").priceModel).toBe("acme-small");
      expect(rowOf(report, "cost").note).toContain(
        '30 use a model with no price, such as "acme-small"',
      );
      expect(rowOf(report, "cost").ask).toBeNull();
      expect(rowOf(report, "cost").example).toBe("trace-3");
      expect(rowOf(report, "conversation").docs).toBe(true);
      expect(rowOf(report, "model").docs).toBe(false);
      expect(code).toContain('LW.navigate("metadataDocs", {})');
      expect(code).toContain('label: "Add a price for " + row.priceModel');
      expect(code).toContain('LW.navigate("modelCosts", {})');
      expect(code).toContain('LW.navigate("trace", { traceId: row.example })');
    });
  });
});
