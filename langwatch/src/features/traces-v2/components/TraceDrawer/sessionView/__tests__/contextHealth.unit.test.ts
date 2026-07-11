import { describe, expect, it } from "vitest";
import {
  contextHealthBand,
  contextWindowCeiling,
} from "../contextHealth";

describe("contextWindowCeiling", () => {
  describe("given a session that only used standard-window models", () => {
    it("returns the 200K ceiling", () => {
      expect(contextWindowCeiling(["claude-opus-4-8", "claude-sonnet-5"])).toBe(
        200_000,
      );
    });
  });

  describe("given a session where any call used the 1M beta", () => {
    it("returns the 1M ceiling, even if other calls used the standard window", () => {
      expect(
        contextWindowCeiling(["claude-opus-4-8", "claude-opus-4-8[1m]"]),
      ).toBe(1_000_000);
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
