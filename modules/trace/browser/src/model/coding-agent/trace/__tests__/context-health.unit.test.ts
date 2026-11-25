import { describe, expect, it } from "vitest";

import { contextHealthBand, contextHeatLabel, contextWindowCeiling } from "../context-health.ts";

describe("contextWindowCeiling", () => {
  describe("given a session that only used standard-window models", () => {
    it("returns the 200K ceiling", () => {
      expect(contextWindowCeiling(["claude-opus-4-8", "claude-sonnet-5"])).toBe(200_000);
    });
  });

  describe("given a session where any call used the 1M beta", () => {
    it("returns the 1M ceiling, even if other calls used the standard window", () => {
      expect(contextWindowCeiling(["claude-opus-4-8", "claude-opus-4-8[1m]"])).toBe(1_000_000);
    });
  });

  describe("given no models at all", () => {
    it("defaults to the standard 200K ceiling", () => {
      expect(contextWindowCeiling([])).toBe(200_000);
    });
  });
});

describe("contextHealthBand", () => {
  it.each([
    [0, "success", "Reliable"],
    [0.19, "success", "Reliable"],
    [0.2, "info", "Degrading"],
    [0.39, "info", "Degrading"],
    [0.4, "warning", "Unreliable"],
    [0.59, "warning", "Unreliable"],
    [0.6, "danger", "Broken"],
    [0.79, "danger", "Broken"],
    [0.8, "danger", "Irrecoverable"],
    [1, "danger", "Irrecoverable"],
  ])("bands a %p ratio as %s / %s", (ratio, tone, label) => {
    const band = contextHealthBand(ratio);
    expect(band.tone).toBe(tone);
    expect(band.label).toBe(label);
  });
});

describe("contextHeatLabel", () => {
  /** @scenario "A context that a frontier model handles comfortably is not called large" */
  it("calls 151K tokens growing, not large", () => {
    expect(contextHeatLabel({ contextTokens: 151_000, model: "claude-opus-5-5" })).toBe("growing");
  });

  /** @scenario "A context is large from 300K tokens" */
  it("calls a context large from 300K tokens, also when the model is unknown", () => {
    expect(contextHeatLabel({ contextTokens: 300_000, model: "claude-opus-5-5" })).toBe("large");
    expect(contextHeatLabel({ contextTokens: 300_000, model: null })).toBe("large");
    expect(contextHeatLabel({ contextTokens: 49_999, model: null })).toBeNull();
  });

  /** @scenario "A model with a wider window is large later" */
  it("waits for 60% of a 1M window before calling it large", () => {
    expect(contextHeatLabel({ contextTokens: 400_000, model: "claude-opus-5-5[1m]" })).toBe(
      "growing",
    );
    expect(contextHeatLabel({ contextTokens: 600_000, model: "claude-opus-5-5[1m]" })).toBe(
      "large",
    );
  });
});
