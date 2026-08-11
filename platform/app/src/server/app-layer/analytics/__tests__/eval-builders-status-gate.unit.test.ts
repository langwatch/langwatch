/**
 * Verdict metrics must only read verdicts from evaluations that actually ran
 * to completion (#6833). The legacy per-evaluator path in
 * `metric-translator.ts` guards score and pass-rate with `Status =
 * 'processed'`; the rollup and slim builders serve the SAME metrics for
 * unkeyed series, so without the equivalent predicate the project-wide chart
 * and the per-evaluator chart disagree on identical data whenever an errored
 * evaluation carries a stray `passed`/`score`.
 *
 * `evaluation_runs` counts deliberately stay unfiltered — an errored
 * evaluation is still a run, matching the legacy `uniqIf` with no status
 * condition.
 */

import { describe, expect, it } from "vitest";
import { buildEvalRollupTimeseriesQuery } from "../query-builders/eval-rollup-timeseries-query";
import { buildEvalSlimTimeseriesQuery } from "../query-builders/eval-slim-timeseries-query";

const baseDates = {
  startDate: new Date("2026-08-01T00:00:00.000Z"),
  endDate: new Date("2026-08-02T00:00:00.000Z"),
  previousPeriodStartDate: new Date("2026-07-31T00:00:00.000Z"),
};

describe("buildEvalRollupTimeseriesQuery — status gate on verdict metrics", () => {
  describe("when serving evaluation_pass_rate", () => {
    const { sql } = buildEvalRollupTimeseriesQuery({
      projectId: "tenant-eval-rollup",
      ...baseDates,
      series: [
        { metric: "evaluations.evaluation_pass_rate", aggregation: "avg" },
      ],
      timeScale: 60,
    });

    it("only sums PassCount/FailCount from processed rows", () => {
      expect(sql).toContain(
        "sumIf(ra.PassCount, ra.Status = 'processed') / nullIf(sumIf(ra.PassCount, ra.Status = 'processed') + sumIf(ra.FailCount, ra.Status = 'processed'), 0)",
      );
    });
  });

  describe("when serving evaluation_score", () => {
    const { sql } = buildEvalRollupTimeseriesQuery({
      projectId: "tenant-eval-rollup",
      ...baseDates,
      series: [{ metric: "evaluations.evaluation_score", aggregation: "avg" }],
      timeScale: 60,
    });

    it("only sums ScoreSum/ScoreCount from processed rows", () => {
      expect(sql).toContain(
        "sumIf(ra.ScoreSum, ra.Status = 'processed') / nullIf(sumIf(ra.ScoreCount, ra.Status = 'processed'), 0)",
      );
    });
  });

  describe("when serving evaluation_runs", () => {
    const { sql } = buildEvalRollupTimeseriesQuery({
      projectId: "tenant-eval-rollup",
      ...baseDates,
      series: [{ metric: "evaluations.evaluation_runs", aggregation: "sum" }],
      timeScale: 60,
    });

    it("counts every run regardless of status (errored runs are still runs)", () => {
      expect(sql).toContain("sum(ra.EvalCount)");
      expect(sql).not.toContain("sumIf(ra.EvalCount");
    });
  });
});

describe("buildEvalSlimTimeseriesQuery — status gate on verdict metrics", () => {
  describe("when serving evaluation_pass_rate", () => {
    const { sql } = buildEvalSlimTimeseriesQuery({
      projectId: "tenant-eval-slim",
      ...baseDates,
      series: [
        { metric: "evaluations.evaluation_pass_rate", aggregation: "avg" },
      ],
      timeScale: 60,
    });

    it("nulls Passed on non-processed rows so avg excludes them", () => {
      expect(sql).toContain(
        "toUInt8(if(ea.Status = 'processed', ea.Passed, NULL))",
      );
    });
  });

  describe("when serving evaluation_score", () => {
    const { sql } = buildEvalSlimTimeseriesQuery({
      projectId: "tenant-eval-slim",
      ...baseDates,
      series: [{ metric: "evaluations.evaluation_score", aggregation: "avg" }],
      timeScale: 60,
    });

    it("nulls Score on non-processed rows so avg excludes them", () => {
      expect(sql).toContain("if(ea.Status = 'processed', ea.Score, NULL)");
    });
  });

  describe("when serving evaluation_runs", () => {
    const { sql } = buildEvalSlimTimeseriesQuery({
      projectId: "tenant-eval-slim",
      ...baseDates,
      series: [
        { metric: "evaluations.evaluation_runs", aggregation: "cardinality" },
      ],
      timeScale: 60,
    });

    it("counts every run regardless of status (errored runs are still runs)", () => {
      expect(sql).toContain("uniq(ea.EvaluationId)");
      expect(sql).not.toContain("Status = 'processed'");
    });
  });
});
