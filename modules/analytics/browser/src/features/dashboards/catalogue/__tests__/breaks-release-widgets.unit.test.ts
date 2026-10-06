/**
 * The "Where my agent breaks" and "Release check" widgets read what their prototype
 * cards show: checked on the stored code and the LangWatchQL each one runs.
 */

import { describe, expect, it } from "vitest";

import { CATALOGUE_WIDGET_BUILDS } from "../index.ts";

function buildOf(id: string) {
  const build = CATALOGUE_WIDGET_BUILDS[id];
  if (!build) throw new Error(`no build for ${id}`);
  return { code: build.code.tsx, sql: build.queries };
}

describe("given the Where my agent breaks widgets", () => {
  /** @scenario "AC60 Where my agent breaks: errors per day are split by what failed first, with changes marked" */
  it("splits errored traces by type or first failing step, with the rate and changes", () => {
    const { code, sql } = buildOf("up-errors");
    expect(sql.types).toContain("StatusCode = 2");
    expect(sql.types).toContain("SpanAttributes['exception.type']");
    expect(sql.types).toContain("argMin(");
    expect(sql.rate).toContain("countIf(HasError) / count()");
    expect(sql.changes).toContain("FROM prompt_versions");
    expect(sql.changes).toContain("FROM model_usage_by_minute");
    expect(code).toContain("<ReferenceLine");
    expect(code).toContain('stackId="bars"');
  });

  /** @scenario "AC61 Where my agent breaks: failing steps show the failures that reached the user" */
  it("counts a failure as recovered when the span above it did not fail", () => {
    const { code, sql } = buildOf("up-where-fails");
    expect(sql.main).toContain("p.SpanId = c.ParentSpanId");
    expect(sql.main).toContain("countIf(c.StatusCode = 2 AND p.StatusCode != 2) AS recovered");
    expect(sql.main).toContain("ORDER BY failures - recovered DESC");
    expect(sql.main).not.toContain("'tool'");
    expect(code).toContain("reached the user");
  });

  /** @scenario "AC62 Where my agent breaks: loops and retries are read from repeated spans" */
  it("finds loops by tool and input, retries by a later sibling after a failure", () => {
    const { code, sql } = buildOf("up-loops");
    expect(sql.daily).toContain("GROUP BY TraceId, SpanName, CapturedInput");
    expect(sql.daily).toContain("HAVING count() >= 3");
    expect(sql.daily).toContain("max(StartTime) > minIf(StartTime, StatusCode = 2)");
    expect(sql.daily).toContain("GROUP BY TraceId, ParentSpanId");
    expect(sql.totals).toContain("sum(CostSum)");
    expect(code).toContain("Cost of the repeats");
  });

  /** @scenario "AC63 Where my agent breaks: tool error rate says how many tool errors the agent recovered" */
  it("reads tool spans only and shows the recovered share and the worst tool", () => {
    const { code, sql } = buildOf("tools-error-rate");
    expect(sql.main).toContain("c.SpanAttributes['langwatch.span.type'] = 'tool'");
    expect(code).toContain("Tool error rate");
    expect(code).toContain("Recovered, of ");
    expect(code).toContain("Worst tool");
  });

  /** @scenario "AC64 Where my agent breaks: wrong tool rate reads one named judge" */
  it("reads the Tool choice evaluator and names it on its empty face", () => {
    const { code, sql } = buildOf("tools-wrong-tool");
    expect(sql.trend).toContain("EvaluatorName = 'Tool choice'");
    expect(sql.halves).toContain("EvaluatorName = 'Tool choice'");
    expect(sql.changes).toContain("FROM prompt_versions");
    expect(code).toContain('Add an evaluator named "Tool choice"');
    expect(code).toContain('LW.navigate("onlineEvaluations", {})');
  });
});

describe("given the Release check widgets", () => {
  /** @scenario "AC65 Release check: the newest test run is compared with the runs before it" */
  it("compares the newest batch with the earlier ones beyond each scenario's flake rate", () => {
    const { code, sql } = buildOf("ship-verdict");
    expect(sql.scenarios).toContain("argMax(BatchRunId, StartedAt)");
    expect(sql.scenarios).toContain("countIf(BatchRunId != newest) AS current_runs");
    expect(sql.costs).toContain("median(duration_ms) AS typical_ms");
    expect(sql.costs).toContain("FROM simulation_trace_metrics");
    expect(code).toContain("Math.min(current, 1 - current)");
    expect(code).toContain("Hold the newest run");
  });

  /** @scenario "AC66 Release check: flaky tests show each scenario's last ten runs" */
  it("keeps each scenario's last ten runs oldest first and calls flaky by its interval", () => {
    const { code, sql } = buildOf("ship-flaky");
    expect(sql.main).toContain("PARTITION BY ScenarioId ORDER BY StartedAt DESC");
    expect(sql.main).toContain("recency <= 10");
    expect(sql.main).toContain("arraySort(");
    expect(code).toContain("low < 0.9 && high > 0.1");
  });

  /** @scenario "AC67 Release check: the last test runs are compared with a baseline" */
  it("lines up the last five runs of the newest suite against the run before the newest", () => {
    const { code, sql } = buildOf("ship-compare");
    expect(sql.main).toContain("argMax(ScenarioSetId, StartedAt)");
    expect(sql.main).toContain("ORDER BY started_at DESC\nLIMIT 5");
    expect(sql.main).toContain("length(s.MetCriteria)");
    expect(code).toContain("runs[Math.min(1, runs.length - 1)]");
    for (const label of [
      "Scenarios passed",
      "Criteria met",
      "Cost per scenario",
      "Typical run time",
    ]) {
      expect(code).toContain(label);
    }
  });

  /** @scenario "AC68 Release check: production is compared before and after the newest change" */
  it("compares the week after the newest change with the same days a week before", () => {
    const { code, sql } = buildOf("ship-rollout");
    expect(sql.traffic).toContain("least(addDays(changed_at, 7)");
    expect(sql.traffic).toContain("subtractDays(after_end, 7) AS before_end");
    expect(sql.checks).toContain("after_even_rate");
    expect(sql.checks).toContain("before_judged * after_passed / after_judged");
    expect(code).toContain("No prompt or model change in this period to compare around.");
  });

  /** @scenario "AC69 Release check: models are compared from experiments that ran them side by side" */
  it("reads experiment runs with two or more targets, named by model", () => {
    const { code, sql } = buildOf("ship-models");
    expect(sql.main).toContain("HAVING uniqExact(TargetId) >= 2");
    expect(sql.main).toContain("JSONExtractString(target, 'model')");
    expect(sql.main).toContain("ORDER BY pass_rate DESC, cost_per_row ASC");
    expect(code).toContain("As good");
  });

  /** @scenario "AC70 Release check: the test set is weighted to the topic mix of real traffic" */
  it("weights each run's topic pass rates by production's topic shares", () => {
    const { code, sql } = buildOf("rag-dataset-versions");
    expect(sql.main).toContain("Origin IN ('', 'application')");
    expect(sql.main).toContain("weighted_rate");
    expect(code).toContain("weighted to real traffic");
  });

  /** @scenario "AC71 Release check: field accuracy per test run reads two named evaluators" */
  it("averages the Field precision and Field recall scores of the last 12 runs", () => {
    const { code, sql } = buildOf("ext-precision-recall");
    expect(sql.main).toContain("EvaluatorName = 'Field precision'");
    expect(sql.main).toContain("EvaluatorName = 'Field recall'");
    expect(sql.main).toContain("LIMIT 12");
    expect(code).toContain('evaluators named \\"Field precision\\" and \\"Field recall\\"');
  });
});
