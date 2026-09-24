// @vitest-environment node
import type { FilterField } from "@langwatch/analytics-contract";
import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import { describe, expect, it } from "vitest";

import { EvaluationFilterMatchingService } from "../evaluation-filter-matching.service.ts";

const SUBJECT = EvaluationFilterMatchingService.create();

type TriggerFilters = Partial<Record<FilterField, unknown>>;

describe("EvaluationFilterMatchingService.matchesEvaluationFilters", () => {
  function makeEval(overrides: Partial<EvaluationRunData> = {}): EvaluationRunData {
    return {
      evaluationId: "eval-1",
      evaluatorId: "evaluator-1",
      evaluatorType: "custom",
      evaluatorName: "Test Evaluator",
      traceId: "trace-1",
      isGuardrail: false,
      status: "processed",
      score: null,
      passed: null,
      label: null,
      details: null,
      inputs: null,
      error: null,
      errorDetails: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      LastEventOccurredAt: Date.now(),
      archivedAt: null,
      scheduledAt: null,
      startedAt: null,
      completedAt: Date.now(),
      costId: null,
      ...overrides,
    };
  }

  describe("when filters are empty", () => {
    it("returns true", () => {
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: [makeEval()],
          filters: {},
        }),
      ).toBe(true);
    });
  });

  describe("when filtering by evaluations.evaluator_id", () => {
    it("matches when evaluatorId is in filter values", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc" })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id": ["eval-abc", "eval-def"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });

    it("does not match when evaluatorId is not in filter values", () => {
      const evals = [makeEval({ evaluatorId: "eval-xyz" })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });
  });

  describe("when filtering by evaluations.evaluator_id.guardrails_only", () => {
    it("matches guardrail evaluator", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", isGuardrail: true })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.guardrails_only": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });

    it("does not match non-guardrail evaluator", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", isGuardrail: false })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.guardrails_only": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });
  });

  describe("when filtering by evaluations.evaluator_id.has_passed", () => {
    it("matches when evaluator has passed result", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", passed: true })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_passed": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });

    it("does not match when passed is null", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", passed: null })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_passed": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });

    it("does not match a verdict attached to an errored run", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", status: "error", passed: false })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_passed": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });
  });

  describe("when filtering by evaluations.evaluator_id.has_score", () => {
    it("matches when evaluator has score", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", score: 0.85 })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_score": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });

    it("does not match when score is null", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", score: null })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_score": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });

    it("does not match a score attached to an errored run", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", status: "error", score: 0.85 })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_score": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });
  });

  describe("when filtering by evaluations.evaluator_id.has_label", () => {
    it("matches when evaluator has label", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", label: "positive" })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_label": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });

    it("does not match when label is null", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", label: null })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_label": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });

    it("does not match when label is empty", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", label: "" })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_label": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });

    it("does not match a label attached to an errored run", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", status: "error", label: "toxic" })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_label": ["eval-abc"],
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });
  });

  describe("when filtering by evaluations.passed (keyed)", () => {
    /** @scenario "A trigger's evaluation filter matches a processed verdict of the named evaluator" */
    it("matches when evaluator passed", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", passed: true })];
      const filters: TriggerFilters = {
        "evaluations.passed": { "eval-abc": ["true"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });

    it("matches when evaluator failed", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", passed: false })];
      const filters: TriggerFilters = {
        "evaluations.passed": { "eval-abc": ["false"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });

    it("does not match when passed value differs", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", passed: false })];
      const filters: TriggerFilters = {
        "evaluations.passed": { "eval-abc": ["true"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });

    it("does not match when evaluator not found", () => {
      const evals = [makeEval({ evaluatorId: "eval-xyz", passed: true })];
      const filters: TriggerFilters = {
        "evaluations.passed": { "eval-abc": ["true"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });

    /** @scenario "A verdict on an errored run never satisfies a trigger's evaluation filter" */
    it("does not fire on a false verdict attached to an errored run (provider timeout is not a quality regression)", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", status: "error", passed: false })];
      const filters: TriggerFilters = {
        "evaluations.passed": { "eval-abc": ["false"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });

    it("does not fire on a verdict attached to a skipped run", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", status: "skipped", passed: true })];
      const filters: TriggerFilters = {
        "evaluations.passed": { "eval-abc": ["true"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });
  });

  describe("when filtering by evaluations.score (double-keyed)", () => {
    it("matches when score equals filter value", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", score: 0.85 })];
      const filters: TriggerFilters = {
        "evaluations.score": { "eval-abc": { score: ["0.85"] } },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });

    it("does not match when score differs", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", score: 0.5 })];
      const filters: TriggerFilters = {
        "evaluations.score": { "eval-abc": { score: ["0.85"] } },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });

    it("does not match a score attached to an errored run", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", status: "error", score: 0.85 })];
      const filters: TriggerFilters = {
        "evaluations.score": { "eval-abc": { score: ["0.85"] } },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });
  });

  describe("when filtering by evaluations.state (keyed)", () => {
    it("matches when status matches", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", status: "processed" })];
      const filters: TriggerFilters = {
        "evaluations.state": { "eval-abc": ["processed"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });

    it("does not match when status differs", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", status: "error" })];
      const filters: TriggerFilters = {
        "evaluations.state": { "eval-abc": ["processed"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });

    it("does not match when filter value is phantom ES value 'Error_Message' and status is 'error'", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", status: "error" })];
      const filters: TriggerFilters = {
        "evaluations.state": { "eval-abc": ["Error_Message"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });

    it("matches when canonical status 'error' is used in the filter", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", status: "error" })];
      const filters: TriggerFilters = {
        "evaluations.state": { "eval-abc": ["error"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });
  });

  describe("when filtering by evaluations.label (keyed)", () => {
    it("matches when label is in filter values", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", label: "positive" })];
      const filters: TriggerFilters = {
        "evaluations.label": { "eval-abc": ["positive", "negative"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });

    it("does not match a label attached to an errored run", () => {
      const evals = [
        makeEval({
          evaluatorId: "eval-abc",
          status: "error",
          label: "positive",
        }),
      ];
      const filters: TriggerFilters = {
        "evaluations.label": { "eval-abc": ["positive"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });

    it("does not match when label is not in filter values", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", label: "neutral" })];
      const filters: TriggerFilters = {
        "evaluations.label": { "eval-abc": ["positive", "negative"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });
  });

  describe("when combining multiple evaluation filters (AND semantics)", () => {
    it("matches when all evaluation filters pass", () => {
      const evals = [
        makeEval({
          evaluatorId: "eval-abc",
          passed: true,
          status: "processed",
          label: "good",
        }),
      ];
      const filters: TriggerFilters = {
        "evaluations.passed": { "eval-abc": ["true"] },
        "evaluations.state": { "eval-abc": ["processed"] },
        "evaluations.label": { "eval-abc": ["good"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });

    it("does not match when one evaluation filter fails", () => {
      const evals = [
        makeEval({
          evaluatorId: "eval-abc",
          passed: true,
          status: "error",
          label: "good",
        }),
      ];
      const filters: TriggerFilters = {
        "evaluations.passed": { "eval-abc": ["true"] },
        "evaluations.state": { "eval-abc": ["processed"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });
  });

  describe("when filtering across multiple evaluators", () => {
    it("matches when each evaluator satisfies its respective filter", () => {
      const evals = [
        makeEval({ evaluatorId: "eval-abc", passed: true }),
        makeEval({
          evaluationId: "eval-2",
          evaluatorId: "eval-def",
          passed: false,
        }),
      ];
      const filters: TriggerFilters = {
        "evaluations.passed": {
          "eval-abc": ["true"],
          "eval-def": ["false"],
        },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });

    /** @scenario "A keyed evaluation filter fails when its evaluator has no run on the trace" */
    it("does not match when one evaluator is missing", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", passed: true })];
      const filters: TriggerFilters = {
        "evaluations.passed": {
          "eval-abc": ["true"],
          "eval-def": ["true"],
        },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(false);
    });
  });

  describe("when non-evaluation fields are present", () => {
    it("ignores trace-level filters", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", passed: true })];
      const filters: TriggerFilters = {
        "traces.origin": ["application"],
        "evaluations.passed": { "eval-abc": ["true"] },
      };
      expect(
        SUBJECT.matchesEvaluationFilters({
          evaluations: evals,
          filters: filters,
        }),
      ).toBe(true);
    });
  });
});
