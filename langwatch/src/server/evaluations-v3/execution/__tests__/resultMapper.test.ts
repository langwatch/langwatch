import { describe, it, expect } from "vitest";
import {
  parseNodeId,
  isEvaluatorNode,
  mapTargetResult,
  mapEvaluatorResult,
  mapNlpEvent,
  mapErrorEvent,
} from "../resultMapper";
import type { StudioServerEvent } from "~/optimization_studio/types/events";

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

    it("maps evaluator error result", () => {
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

    it("throws for non-evaluator node ID", () => {
      expect(() =>
        mapEvaluatorResult("target-1", 0, { status: "success" })
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
        { stripScore: true }
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
        { stripScore: false }
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

    it("does not affect error results when stripScore is true", () => {
      const result = mapEvaluatorResult(
        "target-1.eval-1",
        0,
        {
          status: "error",
          error: "Failed",
        },
        { stripScore: true }
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
      const result = mapErrorEvent("Failed to execute", 2, "target-1", "eval-1");

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
