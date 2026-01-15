import { describe, expect, it } from "vitest";
import { parameterRegistry } from "../../parameterRegistry";
import { buildModelChangeValues, normalizeMaxTokens } from "../tokenUtils";

describe("buildModelChangeValues", () => {
  it("returns model with new model name", () => {
    const result = buildModelChangeValues("claude-3");
    expect(result.model).toBe("claude-3");
  });

  it("returns correct model identifier for full model path", () => {
    const result = buildModelChangeValues("openai/gpt-4.1");
    expect(result.model).toBe("openai/gpt-4.1");
  });

  it("explicitly sets all registered parameters to undefined", () => {
    const result = buildModelChangeValues("claude-3");

    // Verify ALL registry parameters are cleared
    for (const paramName of parameterRegistry.getAllNames()) {
      expect(Object.hasOwn(result, paramName)).toBe(true);
      expect(result[paramName as keyof typeof result]).toBeUndefined();
    }
  });

  it("clears both snake_case and camelCase variants", () => {
    const result = buildModelChangeValues("claude-3");

    // max_tokens has formKey "maxTokens"
    expect(Object.hasOwn(result, "max_tokens")).toBe(true);
    expect(Object.hasOwn(result, "maxTokens")).toBe(true);
    expect(result.max_tokens).toBeUndefined();
    expect(result.maxTokens).toBeUndefined();
  });

  it("stays in sync with parameterRegistry (OCP compliance test)", () => {
    const result = buildModelChangeValues("claude-3");
    const registeredParams = parameterRegistry.getAllNames();

    // Every registered param should be in the result
    for (const param of registeredParams) {
      expect(Object.hasOwn(result, param)).toBe(true);
    }
  });

  it("handles empty string model", () => {
    const result = buildModelChangeValues("");
    expect(result.model).toBe("");
    // Still clears parameters
    expect(Object.hasOwn(result, "temperature")).toBe(true);
    expect(result.temperature).toBeUndefined();
  });
});

describe("normalizeMaxTokens", () => {
  it("uses camelCase when maxTokens key exists (even if undefined)", () => {
    // This is the critical case - buildModelChangeValues sets maxTokens: undefined
    const values = { model: "gpt-4", maxTokens: undefined };
    const result = normalizeMaxTokens(values, 8000);

    expect(result.maxTokens).toBe(8000);
    expect(Object.hasOwn(result, "max_tokens")).toBe(false);
  });

  it("uses camelCase when maxTokens has a value", () => {
    const values = { model: "gpt-4", maxTokens: 4096 };
    const result = normalizeMaxTokens(values, 8000);

    expect(result.maxTokens).toBe(8000);
    expect(Object.hasOwn(result, "max_tokens")).toBe(false);
  });

  it("uses snake_case when max_tokens key exists", () => {
    const values = { model: "gpt-4", max_tokens: 4096 };
    const result = normalizeMaxTokens(values, 8000);

    expect(result.max_tokens).toBe(8000);
    expect(Object.hasOwn(result, "maxTokens")).toBe(false);
  });

  it("defaults to snake_case when neither key exists", () => {
    const values = { model: "gpt-4" };
    const result = normalizeMaxTokens(values, 8000);

    expect(result.max_tokens).toBe(8000);
    expect(Object.hasOwn(result, "maxTokens")).toBe(false);
  });

  it("integrates correctly with buildModelChangeValues", () => {
    // Simulate the model change -> update max_tokens flow
    const afterModelChange = buildModelChangeValues("gpt-4");
    const afterTokenUpdate = normalizeMaxTokens(afterModelChange, 8000);

    // Should use camelCase because buildModelChangeValues sets maxTokens key
    expect(afterTokenUpdate.maxTokens).toBe(8000);
    expect(afterTokenUpdate.model).toBe("gpt-4");
  });
});
