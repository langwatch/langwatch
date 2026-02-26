import { describe, expect, it } from "vitest";
import type { StudioServerEvent } from "~/optimization_studio/types/events";
import {
  coercePassed,
  coerceScore,
  extractTargetOutput,
  isEvaluatorNode,
  mapErrorEvent,
  mapEvaluatorResult,
  mapNlpEvent,
  mapTargetResult,
  parseNodeId,
} from "../resultMapper";

describe("resultMapper", () => {
  describe("parseNodeId", () => {
    it("parses target node ID", () => {
      const result = parseNodeId("target-1");
      expect(result).toEqual({ targetId: "target-1" });
    });

    it("parses evaluator node ID", () => {
      const result = parseNodeId("target-1.eval-1");
      expect(result).toEqual({ targetId: "target-1", evaluatorId: "eval-1" });
    });

    it("handles complex target IDs", () => {
      const result = parseNodeId("my-complex-target-id");
      expect(result).toEqual({ targetId: "my-complex-target-id" });
    });

    it("handles complex evaluator IDs", () => {
      const result = parseNodeId("target-abc.evaluator-xyz");
      expect(result).toEqual({
        targetId: "target-abc",
        evaluatorId: "evaluator-xyz",
      });
    });
  });

  describe("isEvaluatorNode", () => {
    it("returns false for target nodes", () => {
      expect(isEvaluatorNode("target-1")).toBe(false);
    });

    it("returns true for evaluator nodes", () => {
      expect(isEvaluatorNode("target-1.eval-1")).toBe(true);
    });
  });

  describe("extractTargetOutput", () => {
    it("returns undefined for undefined outputs", () => {
      expect(extractTargetOutput(undefined)).toBeUndefined();
    });

    it("returns undefined for empty outputs object", () => {
      expect(extractTargetOutput({})).toBeUndefined();
    });

    it("returns output field when present (backward compatible)", () => {
      expect(extractTargetOutput({ output: "hello world" })).toBe("hello world");
    });

    it("returns full object when output field is present with other fields", () => {
      // When there are multiple keys, we return the full object even if "output" is present
      // Client-side formatting will handle display
      const outputs = { output: "main", extra: "ignored" };
      expect(extractTargetOutput(outputs)).toEqual(outputs);
    });

    it("returns full object for single custom field (non-output key)", () => {
      // Only unwrap when the single key is exactly "output"
      // For other field names like "result", "pizza", etc., preserve the structure
      const outputs = { result: "my title" };
      expect(extractTargetOutput(outputs)).toEqual(outputs);
    });

    it("returns full object for multiple custom fields", () => {
      const outputs = { result: "title", reason: "because it fits" };
      expect(extractTargetOutput(outputs)).toEqual(outputs);
    });

    it("handles nested object in output field", () => {
      const nested = { result: "title", reason: "because" };
      expect(extractTargetOutput({ output: nested })).toEqual(nested);
    });

    it("handles null output value", () => {
      expect(extractTargetOutput({ output: null })).toBeNull();
    });
  });

  describe("coerceScore", () => {
    it("passes through native numbers", () => {
      expect(coerceScore(0.85)).toBe(0.85);
      expect(coerceScore(0)).toBe(0);
      expect(coerceScore(1)).toBe(1);
    });

    it("coerces string numbers", () => {
      expect(coerceScore("0.85")).toBe(0.85);
      expect(coerceScore("1")).toBe(1);
      expect(coerceScore("0")).toBe(0);
      expect(coerceScore("  0.5  ")).toBe(0.5);
    });

    it("returns undefined for non-numeric strings", () => {
      expect(coerceScore("abc")).toBeUndefined();
      expect(coerceScore("")).toBeUndefined();
      expect(coerceScore("  ")).toBeUndefined();
    });

    it("returns undefined for non-number/string types", () => {
      expect(coerceScore(undefined)).toBeUndefined();
      expect(coerceScore(null)).toBeUndefined();
      expect(coerceScore(true)).toBeUndefined();
    });
  });

  describe("coercePassed", () => {
    it("passes through native booleans", () => {
      expect(coercePassed(true)).toBe(true);
      expect(coercePassed(false)).toBe(false);
    });

    it("coerces string booleans (case-insensitive)", () => {
      expect(coercePassed("true")).toBe(true);
      expect(coercePassed("false")).toBe(false);
      expect(coercePassed("TRUE")).toBe(true);
      expect(coercePassed("False")).toBe(false);
      expect(coercePassed("  True  ")).toBe(true);
    });

    it("returns undefined for unrecognized strings", () => {
      expect(coercePassed("yes")).toBeUndefined();
      expect(coercePassed("1")).toBeUndefined();
      expect(coercePassed("")).toBeUndefined();
    });

    it("returns undefined for non-boolean/string types", () => {
      expect(coercePassed(undefined)).toBeUndefined();
      expect(coercePassed(null)).toBeUndefined();
      expect(coercePassed(0)).toBeUndefined();
    });
  });

  describe("mapTargetResult", () => {
    it("maps successful target result", () => {
      const result = mapTargetResult("target-1", 0, {
        outputs: { output: "Hello world" },
        cost: 0.001,
        timestamps: { started_at: 1000, finished_at: 2000 },
        trace_id: "trace-123",
      });

      expect(result).toEqual({
        type: "target_result",
        rowIndex: 0,
        targetId: "target-1",
        output: "Hello world",
        cost: 0.001,
        duration: 1000,
        traceId: "trace-123",
        error: undefined,
      });
    });

    it("maps target error result", () => {
      const result = mapTargetResult("target-1", 2, {
        error: "API key invalid",
        timestamps: { finished_at: 3000 },
      });

      expect(result).toEqual({
        type: "target_result",
        rowIndex: 2,
        targetId: "target-1",
        output: undefined,
        cost: undefined,
        duration: undefined,
        traceId: undefined,
        error: "API key invalid",
      });
    });

    it("handles missing timestamps", () => {
      const result = mapTargetResult("target-1", 0, {
        outputs: { output: "test" },
      });

      expect(result.type).toBe("target_result");
      if (result.type === "target_result") {
        expect(result.duration).toBeUndefined();
      }
    });
  });

  describe("mapEvaluatorResult", () => {
    it("maps successful evaluator result with passed=true", () => {
      const result = mapEvaluatorResult("target-1.eval-1", 0, {
        status: "success",
        outputs: { passed: true, score: 1.0 },
        cost: 0.0001,
        timestamps: { started_at: 1000, finished_at: 1500 },
      });

      expect(result).toEqual({
        type: "evaluator_result",
        rowIndex: 0,
        targetId: "target-1",
        evaluatorId: "eval-1",
        result: {
          status: "processed",
          passed: true,
          score: 1.0,
          label: undefined,
          details: undefined,
          cost: { currency: "USD", amount: 0.0001 },
        },
      });
    });

    it("maps successful evaluator result with passed=false", () => {
      const result = mapEvaluatorResult("target-1.eval-1", 1, {
        status: "success",
        outputs: { passed: false, score: 0.0 },
      });

      expect(result.type).toBe("evaluator_result");
      if (result.type === "evaluator_result") {
        expect(result.result).toMatchObject({
          status: "processed",
          passed: false,
          score: 0.0,
        });
      }
    });

    it("maps evaluator result with label", () => {
      const result = mapEvaluatorResult("target-1.eval-2", 0, {
        status: "success",
        outputs: { label: "positive", score: 0.85 },
      });

      expect(result.type).toBe("evaluator_result");
      if (result.type === "evaluator_result") {
        expect(result.result).toMatchObject({
          status: "processed",
          label: "positive",
          score: 0.85,
        });
      }
    });

    it("maps evaluator error result from execution-level error", () => {
      const result = mapEvaluatorResult("target-1.eval-1", 0, {
        status: "error",
        error: "Evaluator timeout",
      });

      expect(result.type).toBe("evaluator_result");
      if (result.type === "evaluator_result") {
        expect(result.result).toEqual({
          status: "error",
          error_type: "EvaluatorError",
          details: "Evaluator timeout",
          traceback: [],
        });
      }
    });

    it("maps evaluator error result from outputs.status === 'error'", () => {
      // This covers the case where the NLP execution succeeds but the evaluator
      // returns an error in its outputs (e.g., langevals returns 404)
      const result = mapEvaluatorResult("target-1.eval-1", 0, {
        status: "success", // Execution succeeded
        outputs: {
          status: "error", // But evaluator itself returned error
          details:
            "EvaluatorException('404 Evaluator not found: langevals/invalid')",
        },
      });

      expect(result.type).toBe("evaluator_result");
      if (result.type === "evaluator_result") {
        expect(result.result).toEqual({
          status: "error",
          error_type: "EvaluatorError",
          details:
            "EvaluatorException('404 Evaluator not found: langevals/invalid')",
          traceback: [],
        });
      }
    });

    it("prefers execution-level error over outputs.status error", () => {
      const result = mapEvaluatorResult("target-1.eval-1", 0, {
        status: "error",
        error: "Execution failed",
        outputs: {
          status: "error",
          details: "Evaluator error",
        },
      });

      expect(result.type).toBe("evaluator_result");
      if (result.type === "evaluator_result") {
        // Should use execution-level error
        expect(result.result.details).toBe("Execution failed");
      }
    });

    it("throws for non-evaluator node ID", () => {
      expect(() =>
        mapEvaluatorResult("target-1", 0, { status: "success" }),
      ).toThrow("Expected evaluator node ID");
    });

    it("strips score when stripScore option is true", () => {
      const result = mapEvaluatorResult(
        "target-1.eval-1",
        0,
        {
          status: "success",
          outputs: { passed: true, score: 1.0, label: "exact" },
        },
        { stripScore: true },
      );

      expect(result.type).toBe("evaluator_result");
      if (result.type === "evaluator_result") {
        expect(result.result).toMatchObject({
          status: "processed",
          passed: true,
          score: undefined, // Score should be stripped
          label: "exact",
        });
      }
    });

    it("preserves score when stripScore option is false", () => {
      const result = mapEvaluatorResult(
        "target-1.eval-1",
        0,
        {
          status: "success",
          outputs: { passed: true, score: 0.85 },
        },
        { stripScore: false },
      );

      expect(result.type).toBe("evaluator_result");
      if (result.type === "evaluator_result") {
        expect(result.result).toMatchObject({
          status: "processed",
          passed: true,
          score: 0.85, // Score should be preserved
        });
      }
    });

    it("preserves score when no options provided", () => {
      const result = mapEvaluatorResult("target-1.eval-1", 0, {
        status: "success",
        outputs: { passed: false, score: 0.0 },
      });

      expect(result.type).toBe("evaluator_result");
      if (result.type === "evaluator_result") {
        expect(result.result).toMatchObject({
          status: "processed",
          score: 0.0, // Score should be preserved
        });
      }
    });

    it("coerces string score from workflow evaluators", () => {
      const result = mapEvaluatorResult("target-1.eval-1", 0, {
        status: "success",
        outputs: { score: "0.85", passed: true },
      });

      expect(result.type).toBe("evaluator_result");
      if (result.type === "evaluator_result") {
        expect(result.result).toMatchObject({
          status: "processed",
          score: 0.85,
          passed: true,
        });
      }
    });

    it("coerces string passed from workflow evaluators", () => {
      const result = mapEvaluatorResult("target-1.eval-1", 0, {
        status: "success",
        outputs: { passed: "true", score: 1.0 },
      });

      expect(result.type).toBe("evaluator_result");
      if (result.type === "evaluator_result") {
        expect(result.result).toMatchObject({
          status: "processed",
          passed: true,
          score: 1.0,
        });
      }
    });

    it("coerces string 'false' passed value", () => {
      const result = mapEvaluatorResult("target-1.eval-1", 0, {
        status: "success",
        outputs: { passed: "False", score: "0" },
      });

      expect(result.type).toBe("evaluator_result");
      if (result.type === "evaluator_result") {
        expect(result.result).toMatchObject({
          status: "processed",
          passed: false,
          score: 0,
        });
      }
    });

    it("returns undefined for non-numeric string score", () => {
      const result = mapEvaluatorResult("target-1.eval-1", 0, {
        status: "success",
        outputs: { score: "not-a-number", passed: true },
      });

      expect(result.type).toBe("evaluator_result");
      if (result.type === "evaluator_result") {
        expect(result.result).toMatchObject({
          status: "processed",
          score: undefined,
          passed: true,
        });
      }
    });

    it("does not affect error results when stripScore is true", () => {
      const result = mapEvaluatorResult(
        "target-1.eval-1",
        0,
        {
          status: "error",
          error: "Failed",
        },
        { stripScore: true },
      );

      expect(result.type).toBe("evaluator_result");
      if (result.type === "evaluator_result") {
        expect(result.result).toEqual({
          status: "error",
          error_type: "EvaluatorError",
          details: "Failed",
          traceback: [],
        });
      }
    });
  });

  describe("mapNlpEvent", () => {
    const targetNodes = new Set(["target-1", "target-2"]);

    it("maps target completion event", () => {
      const event: StudioServerEvent = {
        type: "component_state_change",
        payload: {
          component_id: "target-1",
          execution_state: {
            status: "success",
            outputs: { output: "Hello" },
            cost: 0.001,
            timestamps: { started_at: 1000, finished_at: 2000 },
          },
        },
      };

      const result = mapNlpEvent(event, 0, targetNodes);

      expect(result).toEqual({
        type: "target_result",
        rowIndex: 0,
        targetId: "target-1",
        output: "Hello",
        cost: 0.001,
        duration: 1000,
        traceId: undefined,
        error: undefined,
      });
    });

    it("maps evaluator completion event", () => {
      const event: StudioServerEvent = {
        type: "component_state_change",
        payload: {
          component_id: "target-1.eval-1",
          execution_state: {
            status: "success",
            outputs: { passed: true, score: 1.0 },
          },
        },
      };

      const result = mapNlpEvent(event, 0, targetNodes);

      expect(result?.type).toBe("evaluator_result");
      expect((result as any).evaluatorId).toBe("eval-1");
      expect((result as any).result.passed).toBe(true);
    });

    it("ignores running state events", () => {
      const event: StudioServerEvent = {
        type: "component_state_change",
        payload: {
          component_id: "target-1",
          execution_state: {
            status: "running",
            timestamps: { started_at: 1000 },
          },
        },
      };

      const result = mapNlpEvent(event, 0, targetNodes);
      expect(result).toBeNull();
    });

    it("ignores entry node events", () => {
      const event: StudioServerEvent = {
        type: "component_state_change",
        payload: {
          component_id: "entry",
          execution_state: {
            status: "success",
            outputs: { question: "test" },
          },
        },
      };

      const result = mapNlpEvent(event, 0, targetNodes);
      expect(result).toBeNull();
    });

    it("ignores debug events", () => {
      const event: StudioServerEvent = {
        type: "debug",
        payload: { message: "starting execution" },
      };

      const result = mapNlpEvent(event, 0, targetNodes);
      expect(result).toBeNull();
    });

    it("ignores done events", () => {
      const event: StudioServerEvent = {
        type: "done",
      };

      const result = mapNlpEvent(event, 0, targetNodes);
      expect(result).toBeNull();
    });

    it("maps target error event", () => {
      const event: StudioServerEvent = {
        type: "component_state_change",
        payload: {
          component_id: "target-1",
          execution_state: {
            status: "error",
            error: "API key invalid",
          },
        },
      };

      const result = mapNlpEvent(event, 0, targetNodes);

      expect(result).toEqual({
        type: "target_result",
        rowIndex: 0,
        targetId: "target-1",
        output: undefined,
        cost: undefined,
        duration: undefined,
        traceId: undefined,
        error: "API key invalid",
      });
    });

    it("maps evaluator error event", () => {
      const event: StudioServerEvent = {
        type: "component_state_change",
        payload: {
          component_id: "target-1.eval-1",
          execution_state: {
            status: "error",
            error: "Evaluator crashed",
          },
        },
      };

      const result = mapNlpEvent(event, 0, targetNodes);

      expect(result?.type).toBe("evaluator_result");
      expect((result as any).result.status).toBe("error");
      expect((result as any).result.details).toBe("Evaluator crashed");
    });

    it("strips score for evaluator in stripScoreEvaluatorIds", () => {
      const event: StudioServerEvent = {
        type: "component_state_change",
        payload: {
          component_id: "target-1.eval-strip",
          execution_state: {
            status: "success",
            outputs: { passed: true, score: 1.0 },
          },
        },
      };

      const result = mapNlpEvent(event, 0, targetNodes, {
        stripScoreEvaluatorIds: new Set(["eval-strip"]),
      });

      expect(result?.type).toBe("evaluator_result");
      if (result?.type === "evaluator_result") {
        expect(result.result).toMatchObject({
          status: "processed",
          passed: true,
          score: undefined, // Score should be stripped
        });
      }
    });

    it("preserves score for evaluator not in stripScoreEvaluatorIds", () => {
      const event: StudioServerEvent = {
        type: "component_state_change",
        payload: {
          component_id: "target-1.eval-keep",
          execution_state: {
            status: "success",
            outputs: { passed: true, score: 0.75 },
          },
        },
      };

      const result = mapNlpEvent(event, 0, targetNodes, {
        stripScoreEvaluatorIds: new Set(["eval-strip"]), // Only eval-strip should be stripped
      });

      expect(result?.type).toBe("evaluator_result");
      if (result?.type === "evaluator_result") {
        expect(result.result).toMatchObject({
          status: "processed",
          passed: true,
          score: 0.75, // Score should be preserved
        });
      }
    });

    it("preserves score when stripScoreEvaluatorIds is not provided", () => {
      const event: StudioServerEvent = {
        type: "component_state_change",
        payload: {
          component_id: "target-1.eval-1",
          execution_state: {
            status: "success",
            outputs: { passed: false, score: 0.0 },
          },
        },
      };

      const result = mapNlpEvent(event, 0, targetNodes);

      expect(result?.type).toBe("evaluator_result");
      if (result?.type === "evaluator_result") {
        expect(result.result).toMatchObject({
          status: "processed",
          passed: false,
          score: 0.0, // Score should be preserved
        });
      }
    });
  });

  describe("mapErrorEvent", () => {
    it("creates generic error event", () => {
      const result = mapErrorEvent("Something went wrong");

      expect(result).toEqual({
        type: "error",
        message: "Something went wrong",
        rowIndex: undefined,
        targetId: undefined,
        evaluatorId: undefined,
      });
    });

    it("creates error event with context", () => {
      const result = mapErrorEvent(
        "Failed to execute",
        2,
        "target-1",
        "eval-1",
      );

      expect(result).toEqual({
        type: "error",
        message: "Failed to execute",
        rowIndex: 2,
        targetId: "target-1",
        evaluatorId: "eval-1",
      });
    });
  });
});
