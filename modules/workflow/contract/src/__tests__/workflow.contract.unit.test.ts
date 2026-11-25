import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { LlmModelNotSetError, studioWorkflowSchema, workflowDslSchema } from "../index.ts";

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

  /** @scenario "A Studio graph saved without execution state is accepted as main accepted it" */
  it("parses a Studio graph that carries no state, with an empty state", () => {
    const result = studioWorkflowSchema.parse({
      spec_version: "1.5",
      name: "Support triage",
      icon: "puzzle",
      description: "",
      version: "1.0",
      nodes: [],
      edges: [],
    });

    expect(result.state).toEqual({});
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
