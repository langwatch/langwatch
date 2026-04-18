/**
 * Unit tests for Experiment.printSummary() — parity with ExperimentRunResult.printSummary.
 *
 * We don't construct a full Experiment (private constructor); instead we exercise the
 * formatter by invoking printSummary on a subclass-bridge that bypasses init. We use
 * reflection via `Object.assign` on an Object.create'd Experiment prototype to populate
 * the cumulative arrays without going through the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { Experiment } from "../experiment";
import type { BatchEntry, EvaluationResult } from "../types";

function buildExperimentFixture(init: {
  evaluations?: EvaluationResult[];
  entries?: BatchEntry[];
  runUrl?: string;
  runId?: string;
}): Experiment {
  // Bypass the private constructor by creating an instance from the prototype.
  const exp = Object.create(Experiment.prototype) as Experiment;
  Object.assign(exp, {
    name: "ci-quality-check",
    runId: init.runId ?? "run_abc",
    experimentSlug: "ci-quality-check",
    cumulativeEvaluations: init.evaluations ?? [],
    cumulativeEntries: init.entries ?? [],
    runUrl: init.runUrl ?? "https://app.langwatch.ai/runs/xyz",
  });
  return exp;
}

function evaluation(overrides: Partial<EvaluationResult>): EvaluationResult {
  return {
    name: "faithfulness",
    evaluator: "ragas/faithfulness",
    trace_id: "trace_abc",
    status: "processed",
    score: 0.9,
    passed: true,
    details: null,
    index: 0,
    label: null,
    cost: null,
    duration: null,
    error_type: null,
    traceback: null,
    target_id: null,
    ...overrides,
  };
}

describe("Experiment.printSummary", () => {
  let logSpy: MockInstance<typeof console.log>;
  let exitSpy: MockInstance<typeof process.exit>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  function output(): string {
    return logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
  }

  describe("when all evaluations passed", () => {
    it("prints the run id, 100% pass rate, and does not exit", () => {
      const exp = buildExperimentFixture({
        evaluations: [
          evaluation({ passed: true }),
          evaluation({ passed: true, index: 1 }),
        ],
      });

      exp.printSummary();

      const out = output();
      expect(out).toContain("run_abc");
      expect(out).toContain("Passed:     2");
      expect(out).toContain("Failed:     0");
      expect(out).toContain("100.0%");
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe("when at least one evaluation failed and exitOnFailure defaults to true", () => {
    it("prints the failure count and calls process.exit(1)", () => {
      const exp = buildExperimentFixture({
        evaluations: [
          evaluation({ passed: true }),
          evaluation({ passed: false, index: 1 }),
        ],
      });

      exp.printSummary();

      expect(output()).toContain("Failed:     1");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("when exitOnFailure is explicitly false", () => {
    it("prints the failure count but does not exit", () => {
      const exp = buildExperimentFixture({
        evaluations: [
          evaluation({ passed: false }),
        ],
      });

      exp.printSummary(false);

      expect(output()).toContain("Failed:     1");
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe("when multiple evaluators are used", () => {
    it("reports per-evaluator pass rate", () => {
      const exp = buildExperimentFixture({
        evaluations: [
          evaluation({ name: "faithfulness", passed: true }),
          evaluation({ name: "faithfulness", passed: false, index: 1 }),
          evaluation({ name: "relevance", passed: true, index: 0 }),
          evaluation({ name: "relevance", passed: true, index: 1 }),
        ],
      });

      exp.printSummary(false);

      const out = output();
      expect(out).toContain("faithfulness");
      expect(out).toContain("relevance");
      expect(out).toContain("50.0% pass rate"); // faithfulness
      expect(out).toContain("100.0% pass rate"); // relevance
    });
  });

  describe("when the experiment has no evaluations", () => {
    it("prints zero counts and does not exit", () => {
      const exp = buildExperimentFixture({});

      exp.printSummary();

      const out = output();
      expect(out).toContain("Passed:     0");
      expect(out).toContain("Failed:     0");
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe("when an iteration errored out (execution failure)", () => {
    it("exits even if all evaluators passed", () => {
      const exp = buildExperimentFixture({
        evaluations: [evaluation({ passed: true })],
        entries: [
          { index: 0, entry: null, duration: 100, error: null, trace_id: "t1" },
          { index: 1, entry: null, duration: 0, error: "LLM timed out", trace_id: "t2" },
        ],
      });

      exp.printSummary();

      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
