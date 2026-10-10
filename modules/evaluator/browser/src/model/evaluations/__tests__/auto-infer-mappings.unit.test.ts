import { describe, expect, it } from "vitest";

import { autoInferMappings } from "../auto-infer-mappings.ts";

const evaluator = (evaluatorType: string) => ({
  config: { evaluatorType },
  fields: [{ identifier: "input" }, { identifier: "output" }, { identifier: "contexts" }],
});

describe("autoInferMappings", () => {
  describe("given an LLM judge at trace level", () => {
    /** @scenario "A new online evaluation maps an LLM judge's input to the whole trace" */
    it("maps the input to the AI-readable trace and keeps the output and contexts", () => {
      expect(
        autoInferMappings({ evaluator: evaluator("langevals/llm_boolean"), level: "trace" }),
      ).toEqual({
        input: { type: "source", sourceId: "trace", path: ["formatted_trace"] },
        output: { type: "source", sourceId: "trace", path: ["output"] },
        contexts: { type: "source", sourceId: "trace", path: ["contexts"] },
      });
    });
  });

  describe("given an LLM judge at thread level", () => {
    /** @scenario "A new online evaluation maps an LLM judge's input to the whole thread" */
    it("maps the input to the thread's steps view", () => {
      expect(
        autoInferMappings({ evaluator: evaluator("langevals/llm_score"), level: "thread" }),
      ).toEqual({
        input: { type: "source", sourceId: "thread", path: ["formatted_traces"] },
      });
    });
  });

  describe("given an evaluator that is not an LLM judge", () => {
    /** @scenario "Auto-inference keeps other evaluators on the trace's own fields" */
    it("maps input and output to the trace's own fields, and the thread input to its traces", () => {
      const other = evaluator("ragas/faithfulness");

      expect(autoInferMappings({ evaluator: other, level: "trace" }).input).toEqual({
        type: "source",
        sourceId: "trace",
        path: ["input"],
      });
      expect(autoInferMappings({ evaluator: other, level: "thread" }).input).toEqual({
        type: "source",
        sourceId: "thread",
        path: ["traces"],
      });
    });
  });

  describe("given no evaluator", () => {
    it("infers nothing", () => {
      expect(autoInferMappings({ evaluator: null, level: "trace" })).toEqual({});
    });
  });
});
