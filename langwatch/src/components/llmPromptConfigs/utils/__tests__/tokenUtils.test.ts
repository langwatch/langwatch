import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL } from "~/utils/constants";
import { parameterRegistry } from "../../parameterRegistry";
import { buildModelChangeValues, normalizeMaxTokens } from "../tokenUtils";

describe("buildModelChangeValues", () => {
  it("returns model with new model name", () => {
    const result = buildModelChangeValues(DEFAULT_MODEL);
    expect(result.model).toBe(DEFAULT_MODEL);
  });

  it("returns correct model identifier for full model path", () => {
    const result = buildModelChangeValues("openai/gpt-4.1");
    expect(result.model).toBe("openai/gpt-4.1");
  });

  it("explicitly sets all registered parameters to undefined", () => {
    const result = buildModelChangeValues(DEFAULT_MODEL);

    for (const paramName of parameterRegistry.getAllNames()) {
      expect(Object.hasOwn(result, paramName)).toBe(true);
      expect(result[paramName as keyof typeof result]).toBeUndefined();
    }
  });

  it("clears both snake_case and camelCase variants", () => {
    const result = buildModelChangeValues(DEFAULT_MODEL);

    expect(Object.hasOwn(result, "max_tokens")).toBe(true);
    expect(Object.hasOwn(result, "maxTokens")).toBe(true);
    expect(result.max_tokens).toBeUndefined();
    expect(result.maxTokens).toBeUndefined();
  });

  it("stays in sync with parameterRegistry (OCP compliance)", () => {
    const result = buildModelChangeValues(DEFAULT_MODEL);
    const registeredParams = parameterRegistry.getAllNames();

    for (const param of registeredParams) {
      expect(Object.hasOwn(result, param)).toBe(true);
    }
  });

  it("handles empty string model", () => {
    const result = buildModelChangeValues("");
    expect(result.model).toBe("");
    expect(Object.hasOwn(result, "temperature")).toBe(true);
    expect(result.temperature).toBeUndefined();
  });
});

describe("normalizeMaxTokens", () => {
  it("uses camelCase when maxTokens key exists (even if undefined)", () => {
    const values = { model: DEFAULT_MODEL, maxTokens: undefined };
    const result = normalizeMaxTokens(values, 8000);

    expect(result.maxTokens).toBe(8000);
    expect(Object.hasOwn(result, "max_tokens")).toBe(false);
  });

  it("uses camelCase when maxTokens has a value", () => {
    const values = { model: DEFAULT_MODEL, maxTokens: 4096 };
    const result = normalizeMaxTokens(values, 8000);

    expect(result.maxTokens).toBe(8000);
    expect(Object.hasOwn(result, "max_tokens")).toBe(false);
  });

  it("uses snake_case when max_tokens key exists", () => {
    const values = { model: DEFAULT_MODEL, max_tokens: 4096 };
    const result = normalizeMaxTokens(values, 8000);

    expect(result.max_tokens).toBe(8000);
    expect(Object.hasOwn(result, "maxTokens")).toBe(false);
  });

  it("defaults to snake_case when neither key exists", () => {
    const values = { model: DEFAULT_MODEL };
    const result = normalizeMaxTokens(values, 8000);

    expect(result.max_tokens).toBe(8000);
    expect(Object.hasOwn(result, "maxTokens")).toBe(false);
  });

  it("integrates correctly with buildModelChangeValues", () => {
    const afterModelChange = buildModelChangeValues(DEFAULT_MODEL);
    const afterTokenUpdate = normalizeMaxTokens(afterModelChange, 8000);

    expect(afterTokenUpdate.maxTokens).toBe(8000);
    expect(afterTokenUpdate.model).toBe(DEFAULT_MODEL);
  });
});
