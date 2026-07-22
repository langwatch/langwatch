import { describe, it, expect } from "vitest";
import { LLM_PARAMETER_MAP } from "../llm-parameters";

describe("LLM_PARAMETER_MAP", () => {
  it("has no duplicate formField values", () => {
    const formFields = LLM_PARAMETER_MAP.map((p) => p.formField);
    expect(formFields).toEqual([...new Set(formFields)]);
  });

  it("has no duplicate otelAttr values (ignoring nulls)", () => {
    const otelAttrs = LLM_PARAMETER_MAP.map((p) => p.otelAttr).filter(
      (a): a is string => a !== null,
    );
    expect(otelAttrs).toEqual([...new Set(otelAttrs)]);
  });

  it("uses only valid coercion types", () => {
    for (const entry of LLM_PARAMETER_MAP) {
      expect(["number", "string"]).toContain(entry.coercion);
    }
  });

  describe("when checking known parameters", () => {
    it("includes temperature", () => {
      const entry = LLM_PARAMETER_MAP.find(
        (p) => p.formField === "temperature",
      );
      expect(entry).toBeDefined();
      expect(entry!.otelAttr).toBe("gen_ai.request.temperature");
      expect(entry!.coercion).toBe("number");
    });

    it("includes reasoning as a string parameter", () => {
      const entry = LLM_PARAMETER_MAP.find(
        (p) => p.formField === "reasoning",
      );
      expect(entry).toBeDefined();
      expect(entry!.coercion).toBe("string");
    });
  });
});
