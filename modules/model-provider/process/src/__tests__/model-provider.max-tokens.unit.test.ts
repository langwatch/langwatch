import { findModelById } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { pickMaxTokensCeiling } from "../rules/max-tokens-ceiling.rules.ts";

describe("pickMaxTokensCeiling", () => {
  it("prefers a configured custom-model ceiling", () => {
    expect(
      pickMaxTokensCeiling("custom/model", {
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
    const model = findModelById("openai/gpt-5")[0];
    expect(model).toBeDefined();
    expect(pickMaxTokensCeiling("openai/gpt-5", null)).toBe(
      model?.maxCompletionTokens ?? undefined,
    );
  });

  it("returns undefined for an unknown model", () => {
    expect(pickMaxTokensCeiling("unknown/model", undefined)).toBeUndefined();
  });
});
