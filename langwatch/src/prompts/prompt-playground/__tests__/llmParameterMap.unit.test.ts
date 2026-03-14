import { describe, it, expect } from "vitest";
import {
  LLM_PARAMETER_MAP,
  KNOWN_PARAM_ALIASES,
} from "../llmParameterMap";

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

  it("has no duplicate traceAliases across entries", () => {
    const allAliases = LLM_PARAMETER_MAP.flatMap((p) => p.traceAliases);
    expect(allAliases).toEqual([...new Set(allAliases)]);
  });

  it("has at least one traceAlias per entry", () => {
    for (const entry of LLM_PARAMETER_MAP) {
      expect(entry.traceAliases.length).toBeGreaterThanOrEqual(1);
    }
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
      expect(entry!.traceAliases).toContain("reasoning_effort");
    });
  });
});

describe("KNOWN_PARAM_ALIASES", () => {
  it("contains all traceAliases from the map", () => {
    for (const entry of LLM_PARAMETER_MAP) {
      for (const alias of entry.traceAliases) {
        expect(KNOWN_PARAM_ALIASES.has(alias)).toBe(true);
      }
    }
  });

  it("has the correct total count", () => {
    const expectedCount = LLM_PARAMETER_MAP.reduce(
      (sum, p) => sum + p.traceAliases.length,
      0,
    );
    expect(KNOWN_PARAM_ALIASES.size).toBe(expectedCount);
  });
});
