/**
 * The Flight Deck cockpit and Running costs widgets store what the prototype's cards compute:
 * string-level checks of their stored code and LangWatchQL.
 */

import { describe, expect, it } from "vitest";

import { NUMBERS } from "../../templates/model/widget-code-parts.ts";
import { OUTCOME_JUDGE } from "../widgets/flight-deck-costs-queries.ts";
import { FLIGHT_DECK_COSTS_BUILDS } from "../widgets/flight-deck-costs-widgets.ts";
import { TESTING_SPEND } from "../widgets/running-costs-code.ts";

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
    for (const label of [
      "Resolved conversations",
      "Conversations",
      "Automatic checks passed",
      "AI cost per resolved conversation",
    ]) {
      expect(code).toContain(`label="${label}"`);
    }
    expect(code).toContain("<Change ");
    for (const sql of Object.values(queries)) expect(sql).toContain("subtractSeconds(");
    expect(queries.checks).toContain("NOT IsGuardrail");
    expect(queries.checks).toContain(`EvaluatorName != '${OUTCOME_JUDGE}'`);
    // One read of the trace evaluations: each verdict carries its trace's time, so no join.
    expect(queries.checks).toContain("FROM trace_evaluation_metrics");
    expect(queries.checks).toContain("countIf(TraceOccurredAt >= ");
    expect(queries.checks).not.toContain("JOIN");
    expect(code).toContain('"Not scored yet"');
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
      expect(sql).toContain(`EvaluatorName = '${OUTCOME_JUDGE}'`);
      expect(sql).toContain("MetadataOutcome AS outcome");
      expect(sql).toContain(
        "argMax(r.outcome, toUInt64(r.sent) * 9223372036854775808 + toUInt64(dateDiff('millisecond', toDateTime64(0, 3), r.row_at)) * 1048576 + cityHash64(r.outcome",
      );
      expect(sql).not.toContain("Attributes[");
    }
    // The moved widgets read the judge from the trace evaluations, dated by the trace on the row.
    const moved = outcomeQueries.filter((sql) => sql?.includes("FROM trace_evaluation_metrics"));
    expect(moved).toHaveLength(6);
    for (const sql of moved) expect(sql).toContain("TraceOccurredAt AS row_at");
    // Only the reasons widget reads a sent reason, from its typed column.
    expect(build("ck-attention").queries.reasons).toContain("nullIf(MetadataOutcomeReason, '')");
    expect(build("ck-kpis").queries.outcomes).not.toContain("MetadataOutcomeReason");
  });

  /** @scenario "AC22 Flight Deck: Needs attention names the one problem to look at first" */
  it("tries a slid segment, a growing failure, a drifting judge and a failing step, in order", () => {
    const { code, queries } = build("ck-attention");
    const order = [
      "biggestDrop(segments.data)",
      "growingReason(reasons.data)",
      "kappa: kappa(row)",
      "step.data[0]",
      "Nothing got worse against the previous period.",
    ].map((text) => code.indexOf(text));
    expect(order.every((index) => index > 0)).toBe(true);
    expect(order.toSorted((a, b) => a - b)).toEqual(order);
    expect(code).toContain("<div title={detail}");
    expect(code).not.toContain("the biggest drop of all {segments.data.length}");
    expect(queries.segments).toContain("'customer'");
    expect(queries.agreement).toContain("FROM annotations");
    expect(queries.step).toContain("countIf(errored AND NOT failed) AS recovered");
  });

  /** @scenario "AC23 Flight Deck: Top request my agent cannot serve names a topic, a count and an example" */
  it("names the topic with the most capability-gap conversations and one request", () => {
    const { code, queries } = build("ck-top-ask");
    expect(queries.gap).toContain("countIf(outcome = 'capability_gap') AS gaps");
    expect(queries.gap).toContain("x.input AS example");
    // The request's text is read from traces for the shown traces only.
    expect(queries.gap).toContain("AND TraceId IN (SELECT trace_id FROM (");
    // Its two copies of the topic list must pick the same trace, so the pick is no `any`.
    expect(queries.gap).toContain("minIf(g.trace_id, g.gaps > 0) AS trace_id");
    expect(queries.gap).not.toContain("anyIf(");
    expect(queries.gap).toContain("ORDER BY gaps DESC");
    expect(code).toContain('LW.navigate("trace", { traceId: top.trace_id })');
    expect(code).toContain("this and your agent could not do it.");
  });

  /** @scenario "AC24 Flight Deck: An outcome widget tells a quiet period from a missing judge" */
  it("checks for outcomes in the last 90 days, only once its own rows are empty", () => {
    for (const id of OUTCOME_WIDGETS) {
      const { code, queries } = build(id);
      expect(queries.seen, id).toContain("subtractDays(now(), 90)");
      expect(code, id).toMatch(
        /<OutcomeEmpty quiet="No (conversations|calls) were scored in this period\." \/>/,
      );
      expect(code, id).toContain("if (seen.data.length > 0) return <Note>{quiet}</Note>;");
      expect(code, id).toContain("Have your app send how each conversation ended");
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
    expect(queries.changes).toContain("MetadataPromptVersion AS name");
    expect(queries.changes).not.toContain("Attributes[");
    expect(code).toContain("markers={changes.data.map((row) => markerOf(row, names))}");
  });

  /** @scenario "AC26 Flight Deck: Task success is the share of calls that got the job done, per language" */
  it("shares resolved calls with an outcome per language", () => {
    const { code, queries } = build("voice-task-success");
    expect(queries.trend).toContain(", MetadataLanguage AS language");
    expect(queries.trend).not.toContain("Attributes[");
    expect(queries.trend).toContain("countIf(outcome = 'resolved') AS done");
    expect(code).toContain('label={languageName(row.language) + ": calls that got the job done"}');
  });

  /** @scenario "AC27 Flight Deck: Accepted, edited or regenerated reads each output's action" */
  it("shares outputs by the action their trace metadata sends", () => {
    const { code, queries } = build("gen-acceptance");
    expect(queries.actions).toContain("MetadataOutputAction AS action");
    for (const action of ["accepted", "edited", "regenerated", "dropped"]) {
      expect(code).toContain(`key: "${action}"`);
    }
  });
});

describe("given the Running costs widgets", () => {
  /** @scenario "AC28 Running costs: Spend shows the period, the cost per success and the month forecast" */
  it("adds evaluator cost to trace cost and runs the month on at the pace of days with traces", () => {
    const { code, queries } = build("cost-verdict");
    expect(queries.spend).toContain("FROM evaluation_metrics");
    expect(queries.month).toContain("toStartOfMonth(now())");
    expect(queries.month).toContain("subtractDays(now(), 7)");
    expect(queries.month).toContain("uniqExact(toDate(OccurredAt))");
    expect(code).toContain("const pace = ratio(m.last_7_days, m.days_with_data);");
    expect(code).toContain('label="Cost per resolved conversation"');
  });

  /** @scenario "AC29 Running costs: Production vs testing splits spend by where it came from" */
  it("splits spend by trace origin and counts evaluator runs as evaluations", () => {
    const { code, queries } = build("cost-by-source");
    for (const source of ["'production'", "'evaluations'", "'simulations'", "'experiments'"]) {
      expect(queries.main).toContain(source);
    }
    expect(queries.main).toContain("'evaluations' AS source\n  FROM evaluation_metrics");
    expect(code).toContain('label="of AI spend goes on testing"');
  });

  /** @scenario "AC29b Running costs: the testing share counts only the rows that are tests" */
  it("counts checks, simulated tests, playground and workflows as testing, never your app or other", () => {
    // oxlint-disable-next-line no-implied-eval
    const testingSpend = new Function(`${NUMBERS}\n${TESTING_SPEND}\nreturn testingSpend;`)() as (
      costOf: (key: string) => number | null,
      total: number | null,
      tracesOf: (key: string) => number,
    ) => number | null;
    const noTests = (key: string) => (key === "production" || key === "other" ? 10 : 0);
    const spend: Record<string, number | null> = {
      production: 96,
      evaluations: null,
      simulations: 0,
      experiments: null,
      other: 4,
    };
    const costOf = (key: string) => spend[key] ?? null;

    expect(testingSpend(costOf, 100, noTests)).toBe(0);
    expect(
      testingSpend(
        (key) => ({ ...spend, evaluations: 3, experiments: 2 })[key] ?? null,
        105,
        noTests,
      ),
    ).toBe(5);
    expect(testingSpend(costOf, null, noTests)).toBeNull();
    // Simulated tests ran on a model with no price: their spend is unknown, never 0%.
    const unpricedTests = (key: string) => (key === "simulations" ? null : costOf(key));
    expect(testingSpend(unpricedTests, 100, (key) => (key === "simulations" ? 4 : 0))).toBeNull();
    expect(testingSpend(unpricedTests, 100, noTests)).toBe(0);
    const { code } = build("cost-by-source");
    expect(code).toContain("const test = testingSpend(costOf, total, tracesOf);");
    expect(code).not.toContain('total - (costOf("production")');
  });

  /** @scenario "AC29b Running costs: the testing share counts only the rows that are tests" */
  it("keeps the chart a readable height above its rows of sources", () => {
    const { code } = build("cost-by-source");
    expect(code).toContain("minHeight: 140");
    expect(FLIGHT_DECK_COSTS_BUILDS["cost-by-source"]?.rows).toBeGreaterThanOrEqual(10);
  });

  type SourceRowProps = {
    cost: number | null;
    traces: number;
    unpriced: number;
    unpricedCounted?: boolean;
    total?: number | null;
  };

  // The stored expressions are what the row runs; evaluating them is the test.
  function sourceRow() {
    const code = build("cost-by-source").code;
    const head = code.match(/function SourceRow\([^)]*\) \{\n([\s\S]*?)\n {2}return \(/)?.[1];
    const width = code.match(/width: (\(share[^}]*?) \}\}/)?.[1];
    const share = code.match(/\{(traces === 0 \? "" : pct\(share, 0\))\}/)?.[1];
    if (!head || !width || !share) throw new Error("no figure, bar or share on the source row");
    // oxlint-disable-next-line no-implied-eval
    const run = new Function(
      "cost",
      "traces",
      "unpriced",
      "unpricedCounted",
      "total",
      "origin",
      `${NUMBERS}\n${head}\nreturn { figure, width: ${width}, share: ${share} };`,
    );
    return ({ cost, traces, unpriced, unpricedCounted = true, total = null }: SourceRowProps) =>
      run(cost, traces, unpriced, unpricedCounted, total, undefined) as {
        figure: string;
        width: string;
        share: string;
      };
  }

  function sourceRowFigure() {
    const row = sourceRow();
    return (cost: number | null, traces: number, unpriced: number, unpricedCounted = true) =>
      row({ cost, traces, unpriced, unpricedCounted }).figure;
  }

  /** @scenario "AC215 Partial cost: no span priced" */
  it('shows "Not priced" on a source row whose traces all lack a cost', () => {
    const rowFigure = sourceRowFigure();
    expect(rowFigure(0, 3, 3)).toBe("Not priced");
    expect(rowFigure(null, 3, 3)).not.toContain("$0.00+");
    expect(rowFigure(null, 2, 2)).toBe("Not priced");
  });

  /** @scenario "AC215b Partial cost: some spans priced at zero" */
  it("shows $0.00 on a source row whose priced spans all cost 0", () => {
    const rowFigure = sourceRowFigure();
    // What SPEND_BY_SOURCE_SQL returns for zero-rate traces: their cost sums to null, not 0.
    expect(rowFigure(null, 2, 1)).toBe("$0.00, some requests not priced");
    expect(rowFigure(null, 2, 0)).toBe("$0.00");
  });

  // Rows as SPEND_BY_SOURCE_SQL returns them: zero-rate traces sum to a null cost.
  const ZERO_RATE_ROWS = [
    { traces: 2, unpriced: 1, cost: null },
    { traces: 2, unpriced: 0, cost: null },
  ];

  /** @scenario "AC215b Partial cost: some spans priced at zero" */
  it("gives a zero-rate row beside a priced row a 0% share and an empty bar", () => {
    const row = sourceRow();
    const priced = { traces: 45, unpriced: 10, cost: 0.2857 };
    const total = priced.cost;
    for (const zeroRate of ZERO_RATE_ROWS) {
      expect(row({ ...zeroRate, total })).toMatchObject({ width: "0%", share: "0%" });
    }
    expect(row({ ...priced, total })).toMatchObject({ width: "100%", share: "100%" });
  });

  /** @scenario "AC215b Partial cost: some spans priced at zero" */
  it("shows no NaN on a board where every row is zero-rate", () => {
    const row = sourceRow();
    // The card total is 0 when a source sums to 0, and null when every source sums to null.
    for (const total of [0, null]) {
      for (const zeroRate of ZERO_RATE_ROWS) {
        const { figure, width, share } = row({ ...zeroRate, total });
        expect(width).toBe("0%");
        expect(share).toBe("–");
        expect(figure).not.toContain("NaN");
      }
    }
  });

  /** @scenario "AC215e Partial cost: the evaluations source row keeps the dash for a null cost" */
  it("keeps the dash on the evaluations row, whose unpriced count is a constant 0", () => {
    // Evaluator runs join the evaluations source with 0 AS unpriced,
    // so a null cost may be unpriced.
    expect(sourceRowFigure()(null, 2, 0, false)).toBe("–");
  });

  /** @scenario "AC30 Running costs: Wasted spend counts each production trace once" */
  it("prices failed traces, loops and recovered retries, each trace once", () => {
    const { code, queries } = build("cost-waste");
    expect(queries.main).toContain("max(ifNull(ParentSpanId, '') = '' AND StatusCode = 2)");
    expect(queries.main).toContain("if(any(SpanType = 'tool') AND count() >= 3, count() - 1, 0)");
    // Trace rows and span groups meet in one grouping; each trace_metrics row counts once.
    expect(queries.main).toContain("GROUP BY trace\n  HAVING rows > 0");
    expect(queries.main).toContain("sumIf(rows, failed) AS failed_traces");
    expect(queries.main).toContain("NOT failed AND repeats = 0 AND retries > 0");
    expect(queries.main).not.toContain("Origin IN");
    expect(code).toContain('" of what your agent cost"');
  });

  /** @scenario "AC31 Running costs: Cost per call shows speech as not priced" */
  it("shows the LLM cost per production call and speech as not priced", () => {
    const { code, queries } = build("voice-cost-per-call");
    expect(queries.total).not.toContain("Origin IN");
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

describe("given the cost widgets' queries", () => {
  const COST_WIDGETS = ["cost-verdict", "cost-by-source", "cost-waste", "voice-cost-per-call"];

  /** @scenario "Template cost queries never count a missing cost as $0" */
  it("sum the cost column as it is, so an unpriced trace adds nothing rather than $0", () => {
    for (const id of [...COST_WIDGETS, "ext-cost-per-doc"]) {
      for (const sql of Object.values(build(id).queries)) {
        expect(sql).not.toContain("ifNull(TotalCost, 0)");
      }
    }
    expect(build("cost-verdict").queries.spend).toContain("sumIf(TotalCost, OccurredAt >= ");
  });

  /** @scenario "Template cost queries never count a missing cost as $0" */
  it("adds trace and evaluator cost so the total is null only when neither has a price", () => {
    const { month } = build("cost-verdict").queries;

    expect(month).toContain("coalesce((SELECT sum(TotalCost) FROM trace_metrics");
  });
});
