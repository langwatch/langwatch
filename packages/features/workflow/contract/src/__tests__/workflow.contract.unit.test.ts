import { describe, expect, it } from "vitest";
import { workflowDslSchema } from "../workflow";

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
    expect(() =>
      workflowDslSchema.parse({ name: "Incomplete", nodes: [], edges: [] }),
    ).toThrow();
  });
});
