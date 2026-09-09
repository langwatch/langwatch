/**
 * @vitest-environment node
 * The `evaluations.*` declaration: the four procedure names the evaluator
 * pickers and the try-it-out panel call, and what each one accepts.
 */
import { describe, expect, it } from "vitest";

import { evaluationTrpc } from "../evaluation.trpc.ts";

describe("given the evaluations tRPC declaration", () => {
  it("declares exactly the procedure names the clients call", () => {
    expect(Object.keys(evaluationTrpc.members).sort()).toEqual([
      "availableCustomEvaluators",
      "availableEvaluators",
      "runEvaluation",
      "warmupLambda",
    ]);
  });

  it("mounts under the namespace the browser caches by", () => {
    expect(evaluationTrpc.namespace).toBe("evaluations");
  });

  describe("when a re-score names its evaluator", () => {
    const runInput = {
      projectId: "project-1",
      traceId: "trace_1",
      settings: {},
      mappings: { mapping: {}, expansions: [] },
    };

    it("accepts a built-in evaluator id", () => {
      const parsed = evaluationTrpc.members.runEvaluation?.input.safeParse({
        ...runInput,
        evaluatorType: "langevals/basic",
      });

      expect(parsed?.success).toBe(true);
    });

    it("accepts a project's own custom evaluator", () => {
      const parsed = evaluationTrpc.members.runEvaluation?.input.safeParse({
        ...runInput,
        evaluatorType: "custom/workflow_1",
      });

      expect(parsed?.success).toBe(true);
    });

    it("refuses an evaluator type that is neither known nor custom", () => {
      const parsed = evaluationTrpc.members.runEvaluation?.input.safeParse({
        ...runInput,
        evaluatorType: "not_an_evaluator",
      });

      expect(parsed?.success).toBe(false);
    });
  });

  describe("when a warm-up names no count", () => {
    it("asks for five probes", () => {
      const parsed = evaluationTrpc.members.warmupLambda?.input.safeParse({
        projectId: "project-1",
      });

      expect(parsed?.success).toBe(true);
      expect(parsed?.success === true ? parsed.data : undefined).toEqual({
        projectId: "project-1",
        count: 5,
      });
    });
  });
});
