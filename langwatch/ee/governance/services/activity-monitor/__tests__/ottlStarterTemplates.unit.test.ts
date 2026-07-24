import { describe, expect, it } from "vitest";

import {
  OTTL_ENABLED_SOURCE_TYPES,
  getStarterTemplate,
  isOttlEnabledSourceType,
} from "../ottlStarterTemplates";

describe("OTTL_ENABLED_SOURCE_TYPES", () => {
  it("only enables OTTL for the custom catch-all (otel_generic)", () => {
    expect(OTTL_ENABLED_SOURCE_TYPES).toEqual(["otel_generic"]);
  });
});

describe("getStarterTemplate", () => {
  it("returns [] for every source type — platform-known tools lift natively, otel_generic is admin-defined", () => {
    expect(getStarterTemplate("claude_code")).toEqual([]);
    expect(getStarterTemplate("codex")).toEqual([]);
    expect(getStarterTemplate("gemini")).toEqual([]);
    expect(getStarterTemplate("opencode")).toEqual([]);
    expect(getStarterTemplate("otel_generic")).toEqual([]);
    expect(getStarterTemplate("workato")).toEqual([]);
    expect(getStarterTemplate("")).toEqual([]);
  });
});

describe("isOttlEnabledSourceType", () => {
  describe("when the source type lifts natively in the receiver (platform-known)", () => {
    it("returns false for claude_code, codex, gemini, opencode", () => {
      expect(isOttlEnabledSourceType("claude_code")).toBe(false);
      expect(isOttlEnabledSourceType("codex")).toBe(false);
      expect(isOttlEnabledSourceType("gemini")).toBe(false);
      expect(isOttlEnabledSourceType("opencode")).toBe(false);
    });
  });

  describe("when the source type is the custom catch-all", () => {
    it("returns true for otel_generic", () => {
      expect(isOttlEnabledSourceType("otel_generic")).toBe(true);
    });
  });

  describe("when the source type is pull-mode or webhook", () => {
    it("returns false for workato, copilot_studio, openai_compliance", () => {
      expect(isOttlEnabledSourceType("workato")).toBe(false);
      expect(isOttlEnabledSourceType("copilot_studio")).toBe(false);
      expect(isOttlEnabledSourceType("openai_compliance")).toBe(false);
    });
  });
});
