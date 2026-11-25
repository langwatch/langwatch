import { describe, expect, it } from "vitest";

import type { CustomModelEntry } from "../../custom-model.ts";
import {
  filterUnsupportedSamplingParams,
  resolveSupportedParameters,
} from "../resolve-supported-parameters.ts";

describe("resolveSupportedParameters", () => {
  describe("when the model has a project-level customModel override", () => {
    /** @scenario Stale top_p is stripped when the model does not support it */
    it("uses the override even if a stricter registry entry exists", () => {
      const provider = {
        customModels: [
          {
            modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
            displayName: "Haiku 4.5",
            mode: "chat",
            supportedParameters: ["temperature"],
          },
        ] as CustomModelEntry[],
      };
      const result = resolveSupportedParameters(
        "bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0",
        provider,
      );
      expect(result).toEqual({ kind: "known", parameters: ["temperature"] });
    });

    it("returns an explicit empty allowlist when set", () => {
      const provider = {
        customModels: [
          {
            modelId: "custom/embed-model",
            displayName: "Embed",
            mode: "embedding",
            supportedParameters: [],
          },
        ] as CustomModelEntry[],
      };
      expect(resolveSupportedParameters("openai/custom/embed-model", provider)).toEqual({
        kind: "known",
        parameters: [],
      });
    });
  });

  describe("when no customModel override exists", () => {
    it("answers unknown for an unknown model so legacy behavior is preserved", () => {
      expect(
        resolveSupportedParameters("bedrock/totally-unknown", {
          customModels: [],
        }),
      ).toEqual({ kind: "unknown" });
    });
  });
});

describe("filterUnsupportedSamplingParams", () => {
  /** @scenario Stale top_p is stripped when the model does not support it */
  it("drops top_p when only temperature is allowed", () => {
    const params = {
      model: "bedrock/haiku",
      temperature: 0.7,
      max_tokens: 1024,
      top_p: 1,
      top_k: 40,
    };
    const out = filterUnsupportedSamplingParams(params, {
      kind: "known",
      parameters: ["temperature"],
    });
    expect(out).toEqual({
      model: "bedrock/haiku",
      temperature: 0.7,
      max_tokens: 1024,
    });
  });

  it("never strips max_tokens even when not in the allowlist", () => {
    const out = filterUnsupportedSamplingParams(
      { model: "x", max_tokens: 2048 },
      { kind: "known", parameters: [] },
    );
    expect(out).toEqual({ model: "x", max_tokens: 2048 });
  });

  it("preserves provider-specific reasoning aliases when reasoning is allowed", () => {
    const out = filterUnsupportedSamplingParams(
      {
        model: "openai/o5",
        temperature: 1,
        reasoning_effort: "high",
        thinkingLevel: "high",
      },
      { kind: "known", parameters: ["temperature", "reasoning"] },
    );
    expect(out).toEqual({
      model: "openai/o5",
      temperature: 1,
      reasoning_effort: "high",
      thinkingLevel: "high",
    });
  });

  it("passes through structural fields untouched", () => {
    const out = filterUnsupportedSamplingParams(
      {
        model: "x",
        messages: [{ role: "user", content: "hi" }],
        tools: [{ name: "t" }],
        response_format: { type: "json_object" },
        stream: true,
        litellm_params: { region: "us-east-1" },
        top_p: 1,
      },
      { kind: "known", parameters: ["temperature"] },
    );
    expect(out).toEqual({
      model: "x",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "t" }],
      response_format: { type: "json_object" },
      stream: true,
      litellm_params: { region: "us-east-1" },
    });
  });

  it("returns the input unchanged when the model is unknown", () => {
    const params = { model: "x", top_p: 0.9, top_k: 40 };
    expect(filterUnsupportedSamplingParams(params, { kind: "unknown" })).toEqual(params);
  });
});
