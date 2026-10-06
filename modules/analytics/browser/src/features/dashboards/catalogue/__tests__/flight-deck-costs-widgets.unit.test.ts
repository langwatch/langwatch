/**
 * The Flight Deck cockpit and Running costs widgets store what the prototype's cards compute:
 * string-level checks of their stored code and LangWatchQL.
 */

import { describe, expect, it } from "vitest";

import { OUTCOME_JUDGE } from "../widgets/flight-deck-costs-queries.ts";
import { FLIGHT_DECK_COSTS_BUILDS } from "../widgets/flight-deck-costs-widgets.ts";

function build(id: string) {
  const found = FLIGHT_DECK_COSTS_BUILDS[id];
  if (!found) throw new Error(`no build for ${id}`);
  return { code: found.code.tsx, queries: found.queries };
}

const OUTCOME_WIDGETS = ["ck-top-ask", "ck-trend", "voice-task-success"];

describe("given the Flight Deck cockpit widgets", () => {
  /** @scenario "AC20 Flight Deck: This period sets four figures against the period before" */
  it("sets resolved, conversations, checks and cost per resolved against the period before", () => {
    const { code, queries } = build("ck-kpis");
    for (const label of ["Resolved", "Conversations", "Checks passing", "AI cost per resolved"]) {
      expect(code).toContain(`label="${label}"`);
    }
    expect(code).toContain("<Change ");
    for (const sql of Object.values(queries)) expect(sql).toContain("subtractSeconds(");
    expect(queries.checks).toContain("NOT e.IsGuardrail");
    expect(queries.checks).toContain(`e.EvaluatorName != '${OUTCOME_JUDGE}'`);
    expect(code).toContain('"Not measured"');
    expect(code).toContain('LW.navigate("onlineEvaluations"');
  });

  /** @scenario "AC21 Flight Deck: An outcome is the outcome judge's label or the outcome a trace sends" */
  it("reads outcomes from the judge's label and the sent outcome, dated by the trace", () => {
    const outcomeQueries = [
      build("ck-kpis").queries.outcomes,
      build("ck-attention").queries.reasons,
      build("ck-top-ask").queries.gap,
      build("ck-trend").queries.trend,
      build("voice-task-success").queries.trend,
      build("cost-verdict").queries.outcomes,
    ];
    for (const sql of outcomeQueries) {
      expect(sql).toContain(`evaluator = '${OUTCOME_JUDGE}'`);
      expect(sql).toContain("Attributes['metadata.outcome']");
      expect(sql).toContain("argMax(outcome, sent)");
      expect(sql).toContain("t.OccurredAt AS at");
    }
  });

  /** @scenario "AC22 Flight Deck: Needs attention names the one problem to look at first" */
  it("tries a slid segment, a growing failure, a drifting judge and a failing step, in order", () => {
    const { code, queries } = build("ck-attention");
    const order = [
      "biggestDrop(segments.data)",
      "growingReason(reasons.data)",
      "kappa: kappa(row)",
      "step.data[0]",
      "Nothing got worse in this period.",
    ].map((text) => code.indexOf(text));
    expect(order.every((index) => index > 0)).toBe(true);
    expect(order.toSorted((a, b) => a - b)).toEqual(order);
    expect(queries.segments).toContain("'customer'");
    expect(queries.agreement).toContain("FROM annotations");
    expect(queries.step).toContain("countIf(errored AND NOT failed) AS recovered");
  });

  /** @scenario "AC23 Flight Deck: Top request it cannot serve names a topic, a count and an example" */
  it("names the topic with the most capability-gap conversations and one request", () => {
    const { code, queries } = build("ck-top-ask");
    expect(queries.gap).toContain("countIf(o.outcome = 'capability_gap') AS gaps");
    expect(queries.gap).toContain("anyIf(t.input, o.outcome = 'capability_gap') AS example");
    expect(queries.gap).toContain("ORDER BY gaps DESC");
    expect(code).toContain("<TraceLink id={top.trace_id} />");
    expect(code).toContain("conversations asked for something it cannot do.");
  });

  /** @scenario "AC24 Flight Deck: An outcome widget tells a quiet period from a missing judge" */
  it("checks for outcomes in the last 90 days, only once its own rows are empty", () => {
    for (const id of OUTCOME_WIDGETS) {
      const { code, queries } = build(id);
      expect(queries.seen, id).toContain("subtractDays(now(), 90)");
      expect(code, id).toMatch(
        /<OutcomeEmpty quiet="No (conversation outcomes|calls with an outcome) in this period\." \/>/,
      );
      expect(code, id).toContain("if (seen.data.length > 0) return <Note>{quiet}</Note>;");
      expect(code, id).toContain(`Add the ${OUTCOME_JUDGE}`);
      expect(code.indexOf('LW.useChartQuery("seen"'), id).toBeGreaterThan(
        code.indexOf("function SeenOrSetup"),
      );
    }
  });

  /** @scenario "AC25 Flight Deck: Resolved per day marks model and prompt changes" */
  it("draws resolved per bucket and marks models and prompt versions first seen", () => {
    const { code, queries } = build("ck-trend");
    expect(queries.trend).toContain("countIf(outcome = 'resolved') AS resolved");
    expect(queries.changes).toContain("arrayJoin(Models)");
    expect(queries.changes).toContain("LastUsedPromptVersionId");
    expect(code).toContain("markers={changes.data.map(markerOf)}");
  });

  /** @scenario "AC26 Flight Deck: Task success is the share of calls that got the job done, per language" */
  it("shares resolved calls with an outcome per language", () => {
    const { code, queries } = build("voice-task-success");
    expect(queries.trend).toContain("Attributes['metadata.language']");
    expect(queries.trend).toContain("countIf(outcome = 'resolved') AS done");
    expect(code).toContain('label={"Task success: " + row.language}');
  });

  /** @scenario "AC27 Flight Deck: Accepted, edited or regenerated reads each output's action" */
  it("shares outputs by the action their trace metadata sends", () => {
    const { code, queries } = build("gen-acceptance");
    expect(queries.actions).toContain("Attributes['metadata.output_action'] AS action");
    for (const action of ["accepted", "edited", "regenerated", "dropped"]) {
      expect(code).toContain(`key: "${action}"`);
    }
  });
});

describe("given the Running costs widgets", () => {
  /** @scenario "AC28 Running costs: Spend shows the period, the cost per success and the month forecast" */
  it("adds evaluator cost to trace cost and runs the month on at the last 7 days' pace", () => {
    const { code, queries } = build("cost-verdict");
    expect(queries.spend).toContain("FROM evaluation_metrics");
    expect(queries.month).toContain("toStartOfMonth(now())");
    expect(queries.month).toContain("subtractDays(now(), 7)");
    expect(code).toContain("(num(m.last_7_days) / 7) * daysLeft");
    expect(code).toContain('label="Cost per success"');
  });

  /** @scenario "AC29 Running costs: Production vs testing splits spend by where it came from" */
  it("splits spend by trace origin and counts evaluator runs as evaluations", () => {
    const { code, queries } = build("cost-by-source");
    for (const source of ["'production'", "'evaluations'", "'simulations'", "'experiments'"]) {
      expect(queries.main).toContain(source);
    }
    expect(queries.main).toContain("'evaluations' AS source\n  FROM evaluation_metrics");
    expect(code).toContain('" is test traffic"');
  });

  /** @scenario "AC30 Running costs: Wasted spend counts each production trace once" */
  it("prices failed traces, loops and recovered retries, each trace once", () => {
    const { code, queries } = build("cost-waste");
    expect(queries.main).toContain("max(ifNull(ParentSpanId, '') = '' AND StatusCode = 2)");
    expect(queries.main).toContain("sumIf(calls - 1, is_tool AND calls >= 3)");
    expect(queries.main).toContain("NOT failed AND repeats = 0 AND retries > 0");
    expect(queries.main).toContain("Origin IN ('', 'application', 'gateway')");
    expect(code).toContain('" of production spend"');
  });

  /** @scenario "AC31 Running costs: Cost per call shows speech as not priced" */
  it("shows the LLM cost per production call and speech as not priced", () => {
    const { code, queries } = build("voice-cost-per-call");
    expect(queries.total).toContain("Origin IN ('', 'application', 'gateway')");
    expect(code).toContain('value="Not priced"');
  });

  /** @scenario "AC32 Running costs: Cost per document is production cost per production trace" */
  it("prices a document per model, compares the halves and marks model changes", () => {
    const { code, queries } = build("ext-cost-per-doc");
    expect(queries.trend).toContain("if(length(Models) = 1, Models[1], 'several models')");
    expect(queries.halves).toContain("subtractSeconds(");
    expect(code).toContain('row.kind === "model"');
    expect(code).toContain('label="Cheapest model"');
  });
});
