import { describe, expect, it } from "vitest";
import { monitorMappingsInputSchema, monitorSchema } from "../src/monitor";

describe("Monitor contract", () => {
  it("normalises legacy empty mappings", () => {
    expect(monitorMappingsInputSchema.parse({})).toEqual({
      mapping: {},
      expansions: [],
    });
  });

  it("parses portable monitor values", () => {
    const monitor = monitorSchema.parse({
      id: "monitor_1",
      projectId: "project_1",
      experimentId: null,
      evaluatorId: "evaluator_1",
      checkType: "hallucination",
      name: "Hallucination",
      slug: "hallucination-1",
      executionMode: "ON_MESSAGE",
      enabled: true,
      preconditions: {},
      parameters: {},
      mappings: { mapping: {}, expansions: [] },
      sample: 1,
      level: "trace",
      threadIdleTimeout: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(monitor.projectId).toBe("project_1");
  });
});
