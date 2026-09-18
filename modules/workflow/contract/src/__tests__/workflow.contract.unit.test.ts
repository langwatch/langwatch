import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { LlmModelNotSetError, workflowDslSchema } from "../index.ts";

describe("Workflow contract", () => {
  it("accepts the portable graph envelope and preserves node values", () => {
    const result = workflowDslSchema.parse({
      version: "1",
      name: "Support triage",
      nodes: [{ id: "entry", type: "entry", data: { outputs: [] } }],
      edges: [],
      future_engine_field: { enabled: true },
    });

    expect(result.name).toBe("Support triage");
    expect(result.future_engine_field).toEqual({ enabled: true });
  });

  it("rejects a graph without a version", () => {
    expect(() => workflowDslSchema.parse({ name: "Incomplete", nodes: [], edges: [] })).toThrow(
      ZodError,
    );
  });

  it("describes a missing LLM model as a handled 422", () => {
    const error = new LlmModelNotSetError("Summarize");

    expect(error).toMatchObject({
      code: "llm_model_not_set",
      httpStatus: 422,
      message: 'LLM node "Summarize" has no model selected. Open the node and choose a model.',
    });
  });
});
