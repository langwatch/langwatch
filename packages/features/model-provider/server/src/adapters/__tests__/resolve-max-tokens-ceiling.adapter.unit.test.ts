import { getModelById } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";
import { resolveMaxTokensCeiling } from "../resolve-max-tokens-ceiling.adapter";

describe("resolveMaxTokensCeiling", () => {
  it("prefers a configured custom-model ceiling", () => {
    expect(
      resolveMaxTokensCeiling("custom/model", {
        customModels: [
          {
            modelId: "model",
            displayName: "Model",
            mode: "chat",
            maxTokens: 2048,
          },
        ],
      }),
    ).toBe(2048);
  });

  it("falls back to the catalog completion limit", () => {
    const model = getModelById("openai/gpt-5");
    expect(model).toBeDefined();
    expect(resolveMaxTokensCeiling("openai/gpt-5", null)).toBe(
      model?.maxCompletionTokens ?? undefined,
    );
  });

  it("returns undefined for an unknown model", () => {
    expect(resolveMaxTokensCeiling("unknown/model", undefined)).toBeUndefined();
  });
});
