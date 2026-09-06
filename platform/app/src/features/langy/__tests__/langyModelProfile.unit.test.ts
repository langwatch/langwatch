import { describe, expect, it } from "vitest";
import { profileLangyModel } from "../logic/langyModelProfile";

describe("profileLangyModel", () => {
  it("classifies explicitly compact models as quick", () => {
    expect(
      profileLangyModel({
        modelId: "openai/gpt-5-mini",
        metadata: {
          description: "A compact model with reduced latency.",
          reasoningConfig: { supported: true },
        },
      }),
    ).toMatchObject({ group: "quick", isQuick: true, hasReasoning: true });
  });

  it("owns deep-research models as long-running reasoning work", () => {
    expect(
      profileLangyModel({
        modelId: "openai/o4-mini-deep-research",
        metadata: { description: "For complex multi-step research tasks." },
      }),
    ).toMatchObject({ group: "reasoning", isLongRunning: true });
  });

  it("groups output-capable models as multimodal", () => {
    expect(
      profileLangyModel({
        modelId: "gemini/gemini-image",
        metadata: { supportsImageInput: true, supportsImageOutput: true },
      }).group,
    ).toBe("multimodal");
  });

  it("does not invent capabilities for custom models", () => {
    expect(
      profileLangyModel({ modelId: "custom/my-model", isCustom: true }),
    ).toEqual({
      group: "custom",
      isQuick: false,
      isLongRunning: false,
      hasReasoning: false,
      isMultimodal: false,
    });
  });
});
