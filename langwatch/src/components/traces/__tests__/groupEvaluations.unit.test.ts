/**
 * Unit tests for evaluation grouping utility.
 *
 * Tests the pure logic that groups evaluations by evaluator_id
 * and determines the latest run per group.
 *
 * @see specs/traces/evaluation-history-grouping.feature
 */
import { describe, expect, it } from "vitest";
import type { ElasticSearchEvaluation } from "../../../server/tracer/types";
import {
  groupEvaluationsByEvaluator,
  type EvaluationGroup,
} from "../groupEvaluations";

function makeEvaluation(
  overrides: Partial<ElasticSearchEvaluation> & {
    evaluation_id: string;
    evaluator_id: string;
  },
): ElasticSearchEvaluation {
  return {
    name: "Test Evaluator",
    status: "processed",
    timestamps: {
      inserted_at: Date.now(),
    },
    ...overrides,
  } as ElasticSearchEvaluation;
}

describe("groupEvaluationsByEvaluator()", () => {
  describe("when evaluations have the same evaluator_id", () => {
    it("groups them into a single entry", () => {
      const evaluations: ElasticSearchEvaluation[] = [
        makeEvaluation({
          evaluation_id: "eval_1",
          evaluator_id: "toxicity",
          name: "Toxicity Check",
          timestamps: { finished_at: 1000 },
        }),
        makeEvaluation({
          evaluation_id: "eval_2",
          evaluator_id: "toxicity",
          name: "Toxicity Check",
          timestamps: { finished_at: 2000 },
        }),
        makeEvaluation({
          evaluation_id: "eval_3",
          evaluator_id: "toxicity",
          name: "Toxicity Check",
          timestamps: { finished_at: 3000 },
        }),
      ];

      const groups = groupEvaluationsByEvaluator(evaluations);

      expect(groups).toHaveLength(1);
      expect(groups[0]!.evaluatorId).toBe("toxicity");
      expect(groups[0]!.runs).toHaveLength(3);
    });

    it("returns the latest run as the first element", () => {
      const evaluations: ElasticSearchEvaluation[] = [
        makeEvaluation({
          evaluation_id: "eval_oldest",
          evaluator_id: "toxicity",
          name: "Toxicity Check",
          score: 0.3,
          passed: false,
          timestamps: { finished_at: 1000 },
        }),
        makeEvaluation({
          evaluation_id: "eval_latest",
          evaluator_id: "toxicity",
          name: "Toxicity Check",
          score: 0.95,
          passed: true,
          timestamps: { finished_at: 3000 },
        }),
        makeEvaluation({
          evaluation_id: "eval_middle",
          evaluator_id: "toxicity",
          name: "Toxicity Check",
          score: 0.8,
          passed: true,
          timestamps: { finished_at: 2000 },
        }),
      ];

      const groups = groupEvaluationsByEvaluator(evaluations);
      const latest = groups[0]!.latest;

      expect(latest.evaluation_id).toBe("eval_latest");
      expect(latest.score).toBe(0.95);
    });

    it("sorts runs from most recent to oldest", () => {
      const evaluations: ElasticSearchEvaluation[] = [
        makeEvaluation({
          evaluation_id: "eval_1",
          evaluator_id: "toxicity",
          timestamps: { finished_at: 1000 },
        }),
        makeEvaluation({
          evaluation_id: "eval_3",
          evaluator_id: "toxicity",
          timestamps: { finished_at: 3000 },
        }),
        makeEvaluation({
          evaluation_id: "eval_2",
          evaluator_id: "toxicity",
          timestamps: { finished_at: 2000 },
        }),
      ];

      const groups = groupEvaluationsByEvaluator(evaluations);
      const runs = groups[0]!.runs;

      expect(runs[0]!.evaluation_id).toBe("eval_3");
      expect(runs[1]!.evaluation_id).toBe("eval_2");
      expect(runs[2]!.evaluation_id).toBe("eval_1");
    });
  });

  describe("when evaluations have different evaluator_ids", () => {
    it("creates separate groups for each evaluator", () => {
      const evaluations: ElasticSearchEvaluation[] = [
        makeEvaluation({
          evaluation_id: "eval_1",
          evaluator_id: "toxicity",
          name: "Toxicity Check",
          timestamps: { finished_at: 2000 },
        }),
        makeEvaluation({
          evaluation_id: "eval_2",
          evaluator_id: "faithfulness",
          name: "Faithfulness",
          timestamps: { finished_at: 1000 },
        }),
        makeEvaluation({
          evaluation_id: "eval_3",
          evaluator_id: "toxicity",
          name: "Toxicity Check",
          timestamps: { finished_at: 3000 },
        }),
        makeEvaluation({
          evaluation_id: "eval_4",
          evaluator_id: "faithfulness",
          name: "Faithfulness",
          timestamps: { finished_at: 4000 },
        }),
      ];

      const groups = groupEvaluationsByEvaluator(evaluations);

      expect(groups).toHaveLength(2);

      const toxicityGroup = groups.find((g) => g.evaluatorId === "toxicity");
      const faithfulnessGroup = groups.find(
        (g) => g.evaluatorId === "faithfulness",
      );

      expect(toxicityGroup!.runs).toHaveLength(2);
      expect(faithfulnessGroup!.runs).toHaveLength(2);
    });
  });

  describe("when evaluations have no evaluator_id", () => {
    it("treats each as an individual ungrouped entry", () => {
      const evaluations: ElasticSearchEvaluation[] = [
        makeEvaluation({
          evaluation_id: "eval_1",
          evaluator_id: undefined as unknown as string,
          name: "Custom Eval 1",
          timestamps: { finished_at: 1000 },
        }),
        makeEvaluation({
          evaluation_id: "eval_2",
          evaluator_id: undefined as unknown as string,
          name: "Custom Eval 2",
          timestamps: { finished_at: 2000 },
        }),
      ];

      const groups = groupEvaluationsByEvaluator(evaluations);

      expect(groups).toHaveLength(2);
      expect(groups[0]!.runs).toHaveLength(1);
      expect(groups[1]!.runs).toHaveLength(1);
    });
  });

  describe("when using timestamp fallbacks", () => {
    it("falls back to started_at when finished_at is missing", () => {
      const evaluations: ElasticSearchEvaluation[] = [
        makeEvaluation({
          evaluation_id: "eval_1",
          evaluator_id: "toxicity",
          timestamps: { started_at: 1000 },
        }),
        makeEvaluation({
          evaluation_id: "eval_2",
          evaluator_id: "toxicity",
          timestamps: { started_at: 3000 },
        }),
      ];

      const groups = groupEvaluationsByEvaluator(evaluations);

      expect(groups[0]!.latest.evaluation_id).toBe("eval_2");
    });

    it("falls back to inserted_at when both finished_at and started_at are missing", () => {
      const evaluations: ElasticSearchEvaluation[] = [
        makeEvaluation({
          evaluation_id: "eval_1",
          evaluator_id: "toxicity",
          timestamps: { inserted_at: 5000 },
        }),
        makeEvaluation({
          evaluation_id: "eval_2",
          evaluator_id: "toxicity",
          timestamps: { inserted_at: 1000 },
        }),
      ];

      const groups = groupEvaluationsByEvaluator(evaluations);

      expect(groups[0]!.latest.evaluation_id).toBe("eval_1");
    });
  });

  describe("when a single evaluator has one run", () => {
    it("creates a group with hasPreviousRuns as false", () => {
      const evaluations: ElasticSearchEvaluation[] = [
        makeEvaluation({
          evaluation_id: "eval_1",
          evaluator_id: "pii_detection",
          name: "PII Detection",
          timestamps: { finished_at: 1000 },
        }),
      ];

      const groups = groupEvaluationsByEvaluator(evaluations);

      expect(groups).toHaveLength(1);
      expect(groups[0]!.hasPreviousRuns).toBe(false);
      expect(groups[0]!.previousRunCount).toBe(0);
    });
  });

  describe("when a group has multiple runs", () => {
    it("reports correct previous run count", () => {
      const evaluations: ElasticSearchEvaluation[] = [
        makeEvaluation({
          evaluation_id: "eval_1",
          evaluator_id: "toxicity",
          timestamps: { finished_at: 1000 },
        }),
        makeEvaluation({
          evaluation_id: "eval_2",
          evaluator_id: "toxicity",
          timestamps: { finished_at: 2000 },
        }),
        makeEvaluation({
          evaluation_id: "eval_3",
          evaluator_id: "toxicity",
          timestamps: { finished_at: 3000 },
        }),
      ];

      const groups = groupEvaluationsByEvaluator(evaluations);

      expect(groups[0]!.hasPreviousRuns).toBe(true);
      expect(groups[0]!.previousRunCount).toBe(2);
    });
  });

  describe("when the latest run has error status", () => {
    it("preserves the error status on the latest run", () => {
      const evaluations: ElasticSearchEvaluation[] = [
        makeEvaluation({
          evaluation_id: "eval_1",
          evaluator_id: "toxicity",
          status: "processed",
          score: 0.8,
          passed: true,
          timestamps: { finished_at: 1000 },
        }),
        makeEvaluation({
          evaluation_id: "eval_2",
          evaluator_id: "toxicity",
          status: "error",
          error: { has_error: true as const, message: "Timeout", stacktrace: [] },
          timestamps: { finished_at: 2000 },
        }),
      ];

      const groups = groupEvaluationsByEvaluator(evaluations);

      expect(groups[0]!.latest.status).toBe("error");
      expect(groups[0]!.runs[1]!.status).toBe("processed");
    });
  });

  describe("when multiple evaluator groups exist", () => {
    it("sorts groups by latest timestamp descending (most recent evaluator first)", () => {
      const evaluations: ElasticSearchEvaluation[] = [
        makeEvaluation({
          evaluation_id: "eval_a1",
          evaluator_id: "alpha",
          name: "Alpha Check",
          timestamps: { finished_at: 1000 },
        }),
        makeEvaluation({
          evaluation_id: "eval_b1",
          evaluator_id: "beta",
          name: "Beta Check",
          timestamps: { finished_at: 5000 },
        }),
        makeEvaluation({
          evaluation_id: "eval_c1",
          evaluator_id: "gamma",
          name: "Gamma Check",
          timestamps: { finished_at: 3000 },
        }),
      ];

      const groups = groupEvaluationsByEvaluator(evaluations);

      expect(groups).toHaveLength(3);
      expect(groups[0]!.evaluatorId).toBe("beta");
      expect(groups[1]!.evaluatorId).toBe("gamma");
      expect(groups[2]!.evaluatorId).toBe("alpha");
    });

    it("produces the same order regardless of input order", () => {
      const evaluationsOrderA: ElasticSearchEvaluation[] = [
        makeEvaluation({
          evaluation_id: "eval_a1",
          evaluator_id: "alpha",
          timestamps: { finished_at: 1000 },
        }),
        makeEvaluation({
          evaluation_id: "eval_b1",
          evaluator_id: "beta",
          timestamps: { finished_at: 3000 },
        }),
        makeEvaluation({
          evaluation_id: "eval_c1",
          evaluator_id: "gamma",
          timestamps: { finished_at: 2000 },
        }),
      ];

      const evaluationsOrderB: ElasticSearchEvaluation[] = [
        makeEvaluation({
          evaluation_id: "eval_c1",
          evaluator_id: "gamma",
          timestamps: { finished_at: 2000 },
        }),
        makeEvaluation({
          evaluation_id: "eval_a1",
          evaluator_id: "alpha",
          timestamps: { finished_at: 1000 },
        }),
        makeEvaluation({
          evaluation_id: "eval_b1",
          evaluator_id: "beta",
          timestamps: { finished_at: 3000 },
        }),
      ];

      const groupsA = groupEvaluationsByEvaluator(evaluationsOrderA);
      const groupsB = groupEvaluationsByEvaluator(evaluationsOrderB);

      const idsA = groupsA.map((g) => g.evaluatorId);
      const idsB = groupsB.map((g) => g.evaluatorId);

      expect(idsA).toEqual(idsB);
      expect(idsA).toEqual(["beta", "gamma", "alpha"]);
    });
  });

  describe("when there are both grouped and ungrouped entries", () => {
    it("places ungrouped entries after grouped entries, sorted by timestamp descending", () => {
      const evaluations: ElasticSearchEvaluation[] = [
        makeEvaluation({
          evaluation_id: "eval_ungrouped_1",
          evaluator_id: undefined as unknown as string,
          name: "Custom Eval Old",
          timestamps: { finished_at: 9000 },
        }),
        makeEvaluation({
          evaluation_id: "eval_grouped_1",
          evaluator_id: "toxicity",
          name: "Toxicity Check",
          timestamps: { finished_at: 2000 },
        }),
        makeEvaluation({
          evaluation_id: "eval_ungrouped_2",
          evaluator_id: undefined as unknown as string,
          name: "Custom Eval New",
          timestamps: { finished_at: 10000 },
        }),
      ];

      const groups = groupEvaluationsByEvaluator(evaluations);

      expect(groups).toHaveLength(3);
      // Grouped entry comes first, even though ungrouped have higher timestamps
      expect(groups[0]!.evaluatorId).toBe("toxicity");
      // Ungrouped entries follow, sorted by timestamp descending
      expect(groups[1]!.latest.evaluation_id).toBe("eval_ungrouped_2");
      expect(groups[2]!.latest.evaluation_id).toBe("eval_ungrouped_1");
    });
  });

  describe("when input is empty", () => {
    it("returns empty array", () => {
      const groups = groupEvaluationsByEvaluator([]);

      expect(groups).toHaveLength(0);
    });

    it("returns empty array for undefined input", () => {
      const groups = groupEvaluationsByEvaluator(undefined);

      expect(groups).toHaveLength(0);
    });
  });
});
