/**
 * The prototype-matching value formats (`cost`, `number`/`tokens`,
 * `duration_min`, `tokens_k`, one-decimal `percent`) and the stable
 * `fixedColor` map that keeps a headline entity the same color everywhere.
 *
 * @see specs/analytics/custom-chart-playground.feature
 */

import { describe, expect, it } from "vitest";

import { fixedColor, formatValue, TOKENS } from "../index";

describe("formatValue prototype formats", () => {
  describe("when format is cost", () => {
    it("uses cents under $100, whole dollars under $10k, then k and M", () => {
      expect(formatValue(50, "cost")).toBe("$50.00");
      expect(formatValue(1234, "cost")).toBe("$1,234");
      expect(formatValue(12345, "cost")).toBe("$12.3k");
      expect(formatValue(1234567, "cost")).toBe("$1.2M");
    });
  });

  describe("when format is number or tokens", () => {
    it("stays precise under 10k, then compacts to k / M / B", () => {
      expect(formatValue(1410, "number")).toBe("1,410");
      expect(formatValue(12345, "tokens")).toBe("12.3k");
      expect(formatValue(1234567, "number")).toBe("1.2M");
      expect(formatValue(1234567890, "tokens")).toBe("1.2B");
    });
  });

  describe("when format is percent", () => {
    it("multiplies by 100 and keeps one decimal", () => {
      expect(formatValue(0.123, "percent")).toBe("12.3%");
    });
  });

  describe("when format is duration_min", () => {
    it("reads as minutes under an hour, then hours and minutes", () => {
      expect(formatValue(38, "duration_min")).toBe("38 min");
      expect(formatValue(130, "duration_min")).toBe("2h 10m");
    });
  });

  describe("when format is tokens_k", () => {
    it("treats the value as thousands", () => {
      expect(formatValue(362, "tokens_k")).toBe("362k");
      expect(formatValue(1200, "tokens_k")).toBe("1.2M");
    });
  });

  describe("when the value is missing", () => {
    it("renders a dash rather than throwing", () => {
      expect(formatValue(null, "cost")).toBe("–");
      expect(formatValue(undefined, "duration_min")).toBe("–");
    });
  });
});

describe("fixedColor", () => {
  describe("when the name is in the fixed map", () => {
    it("returns that entity's pinned ramp color", () => {
      expect(fixedColor("gpt-5")).toBe(TOKENS.ramp[0]);
      expect(fixedColor("Claude Code")).toBe(TOKENS.ramp[1]);
      expect(fixedColor("Databricks Genie")).toBe(TOKENS.ramp[3]);
    });
  });

  describe("when the name is unknown", () => {
    it("hashes to a stable ramp color, the same on every call", () => {
      const first = fixedColor("some-unmapped-agent");
      const second = fixedColor("some-unmapped-agent");
      expect(first).toBe(second);
      expect(TOKENS.ramp).toContain(first);
    });
  });
});

describe("TOKENS", () => {
  it("exposes the prototype ramp and tones", () => {
    expect(TOKENS.ramp[0]).toBe("#4299e1");
    expect(TOKENS.danger).toBe("#e53e3e");
    expect(TOKENS.ok).toBe("#38a169");
    expect(TOKENS.accent).toBe("#ed8926");
  });
});
