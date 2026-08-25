import { describe, expect, it } from "vitest";

import {
  buildWorkflowLlmConfig,
  normalizeWorkflowLlmConfig,
  normalizeWorkflowLlmParameters,
} from "../src/workflow-llm-config";

describe("buildWorkflowLlmConfig", () => {
  it("maps the editor shape to the execution shape", () => {
    expect(
      buildWorkflowLlmConfig({
        model: "openai/gpt-5",
        temperature: 0.7,
        maxTokens: 4096,
        topP: 0.9,
        reasoning: "high",
        litellmParams: { custom_param: "value" },
      }),
    ).toEqual({
      model: "openai/gpt-5",
      temperature: 0.7,
      max_tokens: 4096,
      top_p: 0.9,
      reasoning_effort: "high",
      litellm_params: { custom_param: "value" },
    });
  });

  it("maps every camel-case sampling field", () => {
    expect(
      buildWorkflowLlmConfig({
        model: "openai/gpt-4o",
        temperature: 0.7,
        maxTokens: 4096,
        topP: 0.9,
        frequencyPenalty: 0.5,
        presencePenalty: 0.3,
        seed: 42,
        topK: 50,
        minP: 0.1,
        repetitionPenalty: 1.2,
      }),
    ).toEqual({
      model: "openai/gpt-4o",
      temperature: 0.7,
      max_tokens: 4096,
      top_p: 0.9,
      frequency_penalty: 0.5,
      presence_penalty: 0.3,
      seed: 42,
      top_k: 50,
      min_p: 0.1,
      repetition_penalty: 1.2,
    });
  });

  it("preserves every configured field when no allowlist is known", () => {
    const config = buildWorkflowLlmConfig({
      model: "unknown/model",
      temperature: 0.2,
      topP: 0.8,
      verbosity: "verbose",
    });

    expect(config).toMatchObject({
      model: "unknown/model",
      temperature: 0.2,
      top_p: 0.8,
      verbosity: "verbose",
    });
  });

  it("filters unsupported sampling fields while retaining the hard token ceiling", () => {
    expect(
      buildWorkflowLlmConfig(
        {
          model: "bedrock/model",
          temperature: 0.2,
          topP: 0.8,
          maxTokens: 1000,
          reasoning: "high",
        },
        ["temperature", "reasoning"],
      ),
    ).toEqual({
      model: "bedrock/model",
      temperature: 0.2,
      max_tokens: 1000,
      reasoning_effort: "high",
    });
  });
});

describe("normalizeWorkflowLlmConfig", () => {
  it("normalizes partial parameter values before a model is resolved", () => {
    expect(normalizeWorkflowLlmParameters({ maxTokens: 2048 })).toEqual({
      max_tokens: 2048,
    });
  });

  it("validates known fields while preserving unknown provider parameters", () => {
    expect(
      normalizeWorkflowLlmConfig({
        model: "openai/gpt-5",
        maxTokens: 4096,
        provider_setting: "enabled",
      }),
    ).toEqual({
      model: "openai/gpt-5",
      max_tokens: 4096,
      provider_setting: "enabled",
    });
  });

  it("normalizes every legacy camel-case sampling key", () => {
    expect(
      normalizeWorkflowLlmConfig({
        model: "openai/gpt-5",
        topP: 0.9,
        frequencyPenalty: 0.5,
        presencePenalty: 0.3,
        maxTokens: 4096,
        topK: 40,
        minP: 0.05,
        repetitionPenalty: 1.1,
      }),
    ).toEqual({
      model: "openai/gpt-5",
      top_p: 0.9,
      frequency_penalty: 0.5,
      presence_penalty: 0.3,
      max_tokens: 4096,
      top_k: 40,
      min_p: 0.05,
      repetition_penalty: 1.1,
    });
  });

  it("prefers legacy camel-case values without mutating the input", () => {
    const input = {
      model: "openai/gpt-5",
      maxTokens: 4096,
      max_tokens: 2000,
      reasoning: "high",
      litellm_params: { api_key: "secret" },
    };

    expect(normalizeWorkflowLlmConfig(input)).toEqual({
      model: "openai/gpt-5",
      max_tokens: 4096,
      reasoning: "high",
      litellm_params: { api_key: "secret" },
    });
    expect(input).toEqual({
      model: "openai/gpt-5",
      maxTokens: 4096,
      max_tokens: 2000,
      reasoning: "high",
      litellm_params: { api_key: "secret" },
    });
  });
});
