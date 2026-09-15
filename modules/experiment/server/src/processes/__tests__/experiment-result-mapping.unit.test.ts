/**
 * What a run's engine events become on the wire: which cell a result lands in,
 * what a target's output looks like, what a failure is allowed to say, and what
 * is persisted alongside a verdict.
 * @see specs/experiments-v3/execution-backend.feature
 */
import { describe, expect, it } from "vitest";
import { ValidationError } from "@langwatch/handled-error";
import { UNNAMED_FAILURE, type EvaluationV3Event } from "@langwatch/experiment-contract";
import type { StudioServerEvent } from "@langwatch/workflow-contract";
import {
  coercePassed,
  coerceScore,
  extractTargetOutput,
  mapEvaluatorResult,
  mapNlpEvent,
  mapTargetResult,
  mapThrownErrorEvent,
  mapWorkflowEvaluatorResult,
  parseNodeId,
} from "../experiment-result-mapping.process.ts";

const targetResultOf = (event: EvaluationV3Event) => {
  if (event.type !== "target_result") throw new Error(`expected target_result, got ${event.type}`);
  return event;
};

const evaluatorResultOf = (event: EvaluationV3Event | null) => {
  if (event?.type !== "evaluator_result") {
    throw new Error(`expected evaluator_result, got ${event?.type ?? "null"}`);
  }
  return event;
};

const errorEventOf = (event: EvaluationV3Event) => {
  if (event.type !== "error") throw new Error(`expected error, got ${event.type}`);
  return event;
};

const componentEvent = (
  componentId: string,
  executionState: Record<string, unknown>,
): StudioServerEvent =>
  ({
    type: "component_state_change",
    payload: { component_id: componentId, execution_state: executionState },
  }) as StudioServerEvent;

describe("given an engine event addressed to a cell", () => {
  describe("when the node id is read", () => {
    /** @scenario "A node id names the target and, after the first dot, the evaluator" */
    it.each([
      {
        name: "a bare target id",
        nodeId: "target-1",
        targetId: "target-1",
        evaluatorId: undefined,
      },
      {
        name: "a target and evaluator pair",
        nodeId: "target-1.eval-1",
        targetId: "target-1",
        evaluatorId: "eval-1",
      },
      {
        name: "an evaluator id that itself contains dots",
        nodeId: "target-1.eval.with.dots",
        targetId: "target-1",
        evaluatorId: "eval.with.dots",
      },
    ])("splits $name at the first dot", ({ nodeId, targetId, evaluatorId }) => {
      expect(parseNodeId(nodeId)).toEqual(
        evaluatorId === undefined ? { targetId } : { targetId, evaluatorId },
      );
    });
  });
});

describe("given a target that produced outputs", () => {
  describe("when the outputs are turned into the cell's value", () => {
    /** @scenario "A target's outputs unwrap only when the sole field is the output" */
    it.each([
      { name: "no outputs at all", outputs: undefined, expected: undefined },
      { name: "an empty outputs object", outputs: {}, expected: undefined },
      { name: "a lone output field", outputs: { output: "Hello" }, expected: "Hello" },
      {
        name: "a lone output field holding an object",
        outputs: { output: { nested: true } },
        expected: { nested: true },
      },
      {
        name: "an output field beside another field",
        outputs: { output: "Hello", extra: 1 },
        expected: { output: "Hello", extra: 1 },
      },
      {
        name: "a single differently named field",
        outputs: { pizza: false },
        expected: { pizza: false },
      },
      {
        name: "several custom fields",
        outputs: { result: "a", reason: "b" },
        expected: { result: "a", reason: "b" },
      },
      { name: "a null output value", outputs: { output: null }, expected: null },
    ])("returns $name unwrapped only when it should be", ({ outputs, expected }) => {
      expect(extractTargetOutput(outputs)).toEqual(expected);
    });
  });

  describe("when the target is itself an evaluator", () => {
    /** @scenario "An evaluator column drops the fields its node no longer emits" */
    it("keeps every field the node still emits and drops the ones it nulled", () => {
      const output = extractTargetOutput(
        { passed: true, score: 0.9, details: null, label: undefined, custom: "kept" },
        { isEvaluatorAsTarget: true },
      );

      expect(output).toEqual({ passed: true, score: 0.9, custom: "kept" });
    });

    /** @scenario "An evaluator column drops the fields its node no longer emits" */
    it("leaves the cell empty rather than an object of nulls", () => {
      expect(
        extractTargetOutput({ passed: null, details: undefined }, { isEvaluatorAsTarget: true }),
      ).toBeUndefined();
    });
  });
});

describe("given a stringy score or verdict from a workflow evaluator", () => {
  describe("when it is coerced for storage", () => {
    /** @scenario "A workflow evaluator's stringy score and verdict are read as numbers and booleans" */
    it.each([
      { name: "a native number", value: 0.85, expected: 0.85 },
      { name: "a numeric string", value: "0.85", expected: 0.85 },
      { name: "a blank string", value: "   ", expected: undefined },
      { name: "prose", value: "high", expected: undefined },
      { name: "a boolean", value: true, expected: undefined },
    ])("reads $name as a score", ({ value, expected }) => {
      expect(coerceScore(value)).toBe(expected);
    });

    /** @scenario "A workflow evaluator's stringy score and verdict are read as numbers and booleans" */
    it.each([
      { name: "a native boolean", value: false, expected: false },
      { name: "the word true in any case", value: "TRUE", expected: true },
      { name: "the word false padded", value: " false ", expected: false },
      { name: "prose", value: "maybe", expected: undefined },
      { name: "a number", value: 1, expected: undefined },
    ])("reads $name as a verdict", ({ value, expected }) => {
      expect(coercePassed(value)).toBe(expected);
    });
  });
});

describe("given a target result", () => {
  describe("when the engine reported timestamps", () => {
    /** @scenario "A cell's duration is the wall clock between the engine's timestamps" */
    it("carries the wall clock between them", () => {
      const result = targetResultOf(
        mapTargetResult("target-1", 0, { timestamps: { started_at: 1000, finished_at: 2500 } }),
      );

      expect(result.duration).toBe(1500);
    });

    /** @scenario "A cell's duration is the wall clock between the engine's timestamps" */
    it("reports no duration when one end is missing", () => {
      const result = targetResultOf(
        mapTargetResult("target-1", 0, { timestamps: { started_at: 1000 } }),
      );

      expect(result.duration).toBeUndefined();
    });
  });

  describe("when the engine named the failure with a code", () => {
    /** @scenario "A coded engine failure reaches the cell on the handled channel" */
    it("sends the code and the trace rather than the engine's own words", () => {
      const result = targetResultOf(
        mapTargetResult("target-1", 1, {
          error: 'httpblock: Post "https://api.example.com": lookup api.example.com: no such host',
          error_type: "http_error",
          trace_id: "trace-9",
        }),
      );

      expect(result.domainError?.code).toBe("http_error");
      expect(result.domainError?.traceId).toBe("trace-9");
      expect(JSON.stringify(result.domainError)).not.toContain("no such host");
    });

    /** @scenario "A coded engine failure reaches the cell on the handled channel" */
    it("carries the upstream status the provider answered with", () => {
      const result = targetResultOf(
        mapTargetResult("target-1", 0, {
          error: "httpblock: upstream returned 500",
          error_type: "upstream_http_error",
          upstream_status: 500,
        }),
      );

      expect(result.domainError?.meta).toEqual({ upstreamStatus: 500 });
    });
  });

  describe("when the engine sent no code", () => {
    /** @scenario "A coded engine failure reaches the cell on the handled channel" */
    it("leaves the handled channel empty and keeps the raw line as the fallback", () => {
      const result = targetResultOf(mapTargetResult("target-1", 0, { error: "plain string" }));

      expect(result.domainError).toBeUndefined();
      expect(result.error).toBe("plain string");
    });
  });
});

describe("given an evaluator verdict", () => {
  const processed = { status: "success", outputs: { score: 0.75, passed: true } };

  describe("when the evaluator is a guardrail", () => {
    /** @scenario "A guardrail evaluator stores its verdict without a meaningless score" */
    it("stores the verdict without the score", () => {
      const event = evaluatorResultOf(
        mapEvaluatorResult("target-1.eval-1", 0, processed, { stripScore: true }),
      );

      expect(event.result).toMatchObject({ status: "processed", passed: true, score: undefined });
    });

    /** @scenario "A guardrail evaluator stores its verdict without a meaningless score" */
    it("keeps the score for every other evaluator", () => {
      const event = evaluatorResultOf(mapEvaluatorResult("target-1.eval-1", 0, processed));

      expect(event.result).toMatchObject({ status: "processed", score: 0.75 });
    });
  });

  describe("when both the execution and the evaluator reported a failure", () => {
    /** @scenario "An execution failure outranks the evaluator's own error output" */
    it("reports the execution's failure, not the evaluator's", () => {
      const event = evaluatorResultOf(
        mapEvaluatorResult("target-1.eval-1", 0, {
          status: "error",
          error: "Connection timeout",
          outputs: { status: "error", details: "Evaluator internal error" },
        }),
      );

      expect(event.result).toMatchObject({
        status: "error",
        error_type: "EvaluatorError",
        details: "Connection timeout",
      });
    });
  });

  describe("when the evaluator returned details", () => {
    /** @scenario "An evaluator's details survive only when they are real text" */
    it.each([
      { name: "null", details: null, kept: undefined },
      { name: "an empty string", details: "", kept: undefined },
      { name: "real text", details: "Matched exactly", kept: "Matched exactly" },
    ])("keeps details that are $name as $kept", ({ details, kept }) => {
      const event = evaluatorResultOf(
        mapEvaluatorResult("target-1.eval-1", 0, {
          status: "success",
          outputs: { passed: true, details },
        }),
      );

      expect(event.result).toMatchObject({ status: "processed", details: kept });
    });
  });

  describe("when the verdict came from a comparison judge", () => {
    /** @scenario "A comparison verdict persists only the candidate ids it judged" */
    it("persists only which candidates were judged, not their text", () => {
      const event = evaluatorResultOf(
        mapEvaluatorResult(
          "target-1.eval-1",
          0,
          { status: "success", outputs: { label: "a" } },
          {
            inputs: {
              candidates: [
                { id: "a", output: "a long answer", cost: 0.1 },
                { id: "b", output: "another long answer", cost: 0.2 },
              ],
              golden: "the golden answer",
              input: "the task",
            },
          },
        ),
      );

      expect(event.inputs).toEqual({ candidates: [{ id: "a" }, { id: "b" }] });
    });

    /** @scenario "A comparison verdict persists only the candidate ids it judged" */
    it("persists nothing for an evaluator that judged no candidate list", () => {
      const event = evaluatorResultOf(
        mapEvaluatorResult(
          "target-1.eval-1",
          0,
          { status: "success", outputs: { score: 1 } },
          {
            inputs: { output: "hello", expected_output: "hello" },
          },
        ),
      );

      expect(event.inputs).toBeUndefined();
    });
  });

  describe("when the node id names no evaluator", () => {
    /** @scenario "A verdict addressed to no evaluator fails loudly" */
    it("refuses to map it rather than storing a verdict against nothing", () => {
      expect(() => mapEvaluatorResult("target-1", 0, { status: "success" })).toThrow(
        "Expected evaluator node ID but got: target-1",
      );
    });
  });
});

describe("given a stream of engine events", () => {
  const targetNodes = new Set(["target-1", "target-2"]);

  describe("when an event carries no result yet", () => {
    /** @scenario "Only a finished node's event becomes a result" */
    it.each([
      { name: "a node still running", event: componentEvent("target-1", { status: "running" }) },
      { name: "the entry node", event: componentEvent("entry", { status: "success" }) },
      {
        name: "a node belonging to neither a target nor an evaluator",
        event: componentEvent("stray-node", { status: "success" }),
      },
      { name: "a debug frame", event: { type: "debug", payload: {} } as StudioServerEvent },
      { name: "the done frame", event: { type: "done", payload: {} } as StudioServerEvent },
    ])("maps $name to nothing", ({ event }) => {
      expect(mapNlpEvent({ event, rowIndex: 0, targetNodes })).toBeNull();
    });
  });

  describe("when a finished target node reports", () => {
    /** @scenario "A finished node's event lands in the cell it names" */
    it("lands the output, cost and duration in that target's cell", () => {
      const event = mapNlpEvent({
        event: componentEvent("target-1", {
          status: "success",
          outputs: { output: "Hello" },
          cost: 0.001,
          timestamps: { started_at: 1000, finished_at: 2000 },
        }),
        rowIndex: 4,
        targetNodes,
      });

      expect(event).toMatchObject({
        type: "target_result",
        rowIndex: 4,
        targetId: "target-1",
        output: "Hello",
        cost: 0.001,
        duration: 1000,
      });
    });
  });

  describe("when a finished evaluator node reports", () => {
    /** @scenario "A finished node's event lands in the cell it names" */
    it("lands the verdict under the evaluator the node names", () => {
      const event = evaluatorResultOf(
        mapNlpEvent({
          event: componentEvent("target-1.eval-1", {
            status: "success",
            outputs: { passed: true, score: 1 },
          }),
          rowIndex: 0,
          targetNodes,
        }),
      );

      expect(event).toMatchObject({ targetId: "target-1", evaluatorId: "eval-1" });
      expect(event.result).toMatchObject({ passed: true });
    });

    /** @scenario "A guardrail evaluator stores its verdict without a meaningless score" */
    it("strips the score only for the evaluators the run named as guardrails", () => {
      const stripped = evaluatorResultOf(
        mapNlpEvent({
          event: componentEvent("target-1.eval-strip", {
            status: "success",
            outputs: { passed: true, score: 1 },
          }),
          rowIndex: 0,
          targetNodes,
          config: { stripScoreEvaluatorIds: new Set(["eval-strip"]) },
        }),
      );
      const kept = evaluatorResultOf(
        mapNlpEvent({
          event: componentEvent("target-1.eval-keep", {
            status: "success",
            outputs: { passed: true, score: 1 },
          }),
          rowIndex: 0,
          targetNodes,
          config: { stripScoreEvaluatorIds: new Set(["eval-strip"]) },
        }),
      );

      expect(stripped.result).toMatchObject({ score: undefined });
      expect(kept.result).toMatchObject({ score: 1 });
    });

    /** @scenario "A comparison verdict persists only the candidate ids it judged" */
    it("threads the request's candidate list through to the stored verdict", () => {
      const event = evaluatorResultOf(
        mapNlpEvent({
          event: componentEvent("target-1.eval-1", {
            status: "success",
            outputs: { label: "target-a" },
          }),
          rowIndex: 0,
          targetNodes,
          evaluatorInputs: { candidates: [{ id: "target-a" }, { id: "target-b" }] },
        }),
      );

      expect(event.inputs).toEqual({ candidates: [{ id: "target-a" }, { id: "target-b" }] });
    });
  });
});

describe("given a failure thrown mid-run", () => {
  describe("when we know what went wrong", () => {
    /** @scenario "A named failure reaches the customer as its code, an unnamed one as a marker" */
    it("sends the code and the payload the client renders from", () => {
      const event = errorEventOf(
        mapThrownErrorEvent({
          error: new ValidationError("The dataset is missing a column"),
          rowIndex: 3,
          targetId: "target-1",
        }),
      );

      expect(event).toMatchObject({
        message: "validation_error",
        rowIndex: 3,
        targetId: "target-1",
      });
      expect(event.domainError).toMatchObject({ code: "validation_error", httpStatus: 422 });
    });
  });

  describe("when we do not", () => {
    const connectionRefused = () => new Error("connect ECONNREFUSED 10.0.0.5:5432");

    /** @scenario "A named failure reaches the customer as its code, an unnamed one as a marker" */
    it("puts neither host nor port anywhere on the event", () => {
      const serialised = JSON.stringify(
        mapThrownErrorEvent({ error: connectionRefused(), rowIndex: 0, targetId: "target-1" }),
      );

      expect(serialised).not.toContain("10.0.0.5");
      expect(serialised).not.toContain("5432");
      expect(serialised).not.toContain("ECONNREFUSED");
    });

    /** @scenario "A named failure reaches the customer as its code, an unnamed one as a marker" */
    it("carries a marker rather than server-authored words", () => {
      const event = errorEventOf(
        mapThrownErrorEvent({ error: connectionRefused(), rowIndex: 0, targetId: "target-1" }),
      );

      expect(event.message).toBe(UNNAMED_FAILURE);
      expect(event.domainError).toBeUndefined();
    });

    /** @scenario "A named failure reaches the customer as its code, an unnamed one as a marker" */
    it("says nothing more when the failure took the whole run instead of one cell", () => {
      const runLevel = errorEventOf(mapThrownErrorEvent({ error: new Error("boom") }));
      const cellLevel = errorEventOf(
        mapThrownErrorEvent({ error: new Error("boom"), rowIndex: 0, targetId: "target-1" }),
      );

      expect(runLevel.message).toBe(UNNAMED_FAILURE);
      expect(runLevel.rowIndex).toBeUndefined();
      expect(cellLevel.message).toBe(UNNAMED_FAILURE);
      expect(cellLevel.rowIndex).toBe(0);
    });
  });
});

describe("given an evaluator node inside a studio workflow", () => {
  describe("when it carries a display name", () => {
    /** @scenario "A workflow evaluator's verdict shows the node's name, not its id" */
    it("shows the name over the raw node id", () => {
      const event = evaluatorResultOf(
        mapWorkflowEvaluatorResult(0, "target-1", "node-abc", "Answer Relevancy", {
          status: "success",
          outputs: { passed: true, score: "0.9" },
        }),
      );

      expect(event.evaluatorName).toBe("Answer Relevancy");
      expect(event.result).toMatchObject({ status: "processed", score: 0.9, passed: true });
    });
  });

  describe("when it carries none", () => {
    /** @scenario "A workflow evaluator's verdict shows the node's name, not its id" */
    it("leaves the name unset so storage falls back to the node id", () => {
      const event = evaluatorResultOf(
        mapWorkflowEvaluatorResult(0, "target-1", "node-abc", undefined, {
          status: "success",
          outputs: { passed: true },
        }),
      );

      expect(event.evaluatorName).toBeUndefined();
    });
  });

  describe("when the engine named its failure", () => {
    /** @scenario "A coded engine failure reaches the cell on the handled channel" */
    it("sends the code on the handled channel beside the raw details", () => {
      const event = evaluatorResultOf(
        mapWorkflowEvaluatorResult(0, "target-1", "node-abc", "Judge", {
          status: "error",
          error: "llm call failed",
          nodeErrorCode: "llm_error",
          trace_id: "trace-3",
        }),
      );

      expect(event.result).toMatchObject({ status: "error", details: "llm call failed" });
      expect(event.result.status === "error" ? event.result.domainError?.code : undefined).toBe(
        "llm_error",
      );
    });
  });
});
