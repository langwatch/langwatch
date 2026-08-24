import { describe, expect, it } from "vitest";
import { suiteTargetSchema } from "../src";

describe("Suite contract", () => {
  it("accepts prompt mappings", () => {
    expect(
      suiteTargetSchema.parse({
        type: "prompt",
        referenceId: "prompt_1",
        scenarioMappings: {
          question: { type: "source", sourceId: "scenario_1", path: ["input"] },
        },
      }),
    ).toMatchObject({ type: "prompt", referenceId: "prompt_1" });
  });

  it("rejects mappings for targets that do not support them", () => {
    expect(() =>
      suiteTargetSchema.parse({
        type: "workflow",
        referenceId: "workflow_1",
        scenarioMappings: {
          question: { type: "value", value: "hello" },
        },
      }),
    ).toThrow();
  });
});
