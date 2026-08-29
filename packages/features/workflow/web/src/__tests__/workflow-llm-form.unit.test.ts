import type { LLMConfig } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";
import { type FormLLMConfig, LLMConfigFormatUtils } from "../workflow-llm-form";

const completeForm = {
  model: "openai/gpt-5",
  temperature: 0.7,
  maxTokens: 4096,
  topP: 0.9,
  frequencyPenalty: 0.5,
  presencePenalty: 0.3,
  seed: 42,
  topK: 40,
  minP: 0.05,
  repetitionPenalty: 1.1,
  reasoning: "medium",
  verbosity: "verbose",
  litellmParams: { api_base: "https://example.com" },
} satisfies FormLLMConfig;

const completeDsl = {
  model: "openai/gpt-5",
  temperature: 0.7,
  max_tokens: 4096,
  top_p: 0.9,
  frequency_penalty: 0.5,
  presence_penalty: 0.3,
  seed: 42,
  top_k: 40,
  min_p: 0.05,
  repetition_penalty: 1.1,
  reasoning: "medium",
  verbosity: "verbose",
  litellm_params: { api_base: "https://example.com" },
} satisfies LLMConfig;

describe("LLMConfigFormatUtils", () => {
  it("maps the complete browser form to the workflow DSL", () => {
    expect(LLMConfigFormatUtils.formToDslFormat(completeForm)).toEqual(completeDsl);
  });

  it("maps the complete workflow DSL to the browser form", () => {
    expect(LLMConfigFormatUtils.dslToFormFormat(completeDsl)).toEqual(completeForm);
  });

  it.each([
    [{ reasoning_effort: "low" }, "low"],
    [{ thinkingLevel: "medium" }, "medium"],
    [{ effort: "high" }, "high"],
  ])("normalizes a legacy reasoning field", (legacyFields, expected) => {
    const form = LLMConfigFormatUtils.dslToFormFormat({
      model: "legacy-model",
      ...legacyFields,
    });

    expect(form.reasoning).toBe(expected);
  });

  it("prefers canonical reasoning over legacy provider fields", () => {
    const form = LLMConfigFormatUtils.dslToFormFormat({
      model: "mixed-model",
      reasoning: "high",
      reasoning_effort: "low",
      thinkingLevel: "medium",
      effort: "minimal",
    });

    expect(form.reasoning).toBe("high");
  });

  it("writes legacy reasoning back through the canonical field", () => {
    const form = LLMConfigFormatUtils.dslToFormFormat({
      model: "legacy-model",
      reasoning_effort: "high",
    });
    const dsl = LLMConfigFormatUtils.formToDslFormat(form);

    expect(dsl.reasoning).toBe("high");
    expect(dsl).not.toHaveProperty("reasoning_effort");
  });

  it("round-trips both representations without losing values", () => {
    const formRoundTrip = LLMConfigFormatUtils.dslToFormFormat(
      LLMConfigFormatUtils.formToDslFormat(completeForm),
    );
    const dslRoundTrip = LLMConfigFormatUtils.formToDslFormat(
      LLMConfigFormatUtils.dslToFormFormat(completeDsl),
    );

    expect(formRoundTrip).toEqual(completeForm);
    expect(dslRoundTrip).toEqual(completeDsl);
  });
});
