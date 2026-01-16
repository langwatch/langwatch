import { describe, expect, it } from "vitest";
import { resolveDisplayParameters } from "../resolveDisplayParameters";
import type { ReasoningConfig } from "../../../../server/modelProviders/llmModels.types";

describe("resolveDisplayParameters", () => {
  it("substitutes reasoning with reasoning_effort for OpenAI", () => {
    const reasoningConfig: ReasoningConfig = {
      supported: true,
      parameterName: "reasoning_effort",
      allowedValues: ["low", "medium", "high"],
      defaultValue: "medium",
      canDisable: false,
    };

    const result = resolveDisplayParameters(
      ["reasoning", "max_tokens"],
      reasoningConfig
    );

    expect(result).toEqual(["reasoning_effort", "max_tokens"]);
  });

  it("substitutes reasoning with thinkingLevel for Gemini", () => {
    const reasoningConfig: ReasoningConfig = {
      supported: true,
      parameterName: "thinkingLevel",
      allowedValues: ["low", "high"],
      defaultValue: "low",
      canDisable: true,
    };

    const result = resolveDisplayParameters(
      ["reasoning", "temperature"],
      reasoningConfig
    );

    expect(result).toEqual(["thinkingLevel", "temperature"]);
  });

  it("substitutes reasoning with effort for Anthropic", () => {
    const reasoningConfig: ReasoningConfig = {
      supported: true,
      parameterName: "effort",
      allowedValues: ["low", "medium", "high"],
      defaultValue: "medium",
      canDisable: false,
    };

    const result = resolveDisplayParameters(
      ["reasoning", "max_tokens", "temperature"],
      reasoningConfig
    );

    expect(result).toEqual(["effort", "max_tokens", "temperature"]);
  });

  it("returns original params when no reasoningConfig", () => {
    const result = resolveDisplayParameters(
      ["reasoning", "max_tokens"],
      undefined
    );

    expect(result).toEqual(["reasoning", "max_tokens"]);
  });

  it("returns original params when reasoningConfig has no parameterName", () => {
    // Edge case: reasoningConfig exists but parameterName is undefined
    const partialConfig = { supported: false } as ReasoningConfig;

    const result = resolveDisplayParameters(
      ["reasoning", "max_tokens"],
      partialConfig
    );

    expect(result).toEqual(["reasoning", "max_tokens"]);
  });

  it("preserves order of parameters", () => {
    const reasoningConfig: ReasoningConfig = {
      supported: true,
      parameterName: "reasoning_effort",
      allowedValues: ["low", "medium", "high"],
      defaultValue: "medium",
      canDisable: false,
    };

    const result = resolveDisplayParameters(
      ["max_tokens", "reasoning", "temperature", "top_p"],
      reasoningConfig
    );

    expect(result).toEqual(["max_tokens", "reasoning_effort", "temperature", "top_p"]);
  });

  it("handles params without reasoning", () => {
    const reasoningConfig: ReasoningConfig = {
      supported: true,
      parameterName: "reasoning_effort",
      allowedValues: ["low", "medium", "high"],
      defaultValue: "medium",
      canDisable: false,
    };

    const result = resolveDisplayParameters(
      ["temperature", "max_tokens", "top_p"],
      reasoningConfig
    );

    expect(result).toEqual(["temperature", "max_tokens", "top_p"]);
  });
});
