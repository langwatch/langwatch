import { describe, expect, it } from "vitest";
import { alignMaxToStep, stepPrecision } from "../useSliderControl";

describe("stepPrecision", () => {
  it("returns 0 for integer steps", () => {
    expect(stepPrecision(1)).toBe(0);
    expect(stepPrecision(256)).toBe(0);
  });

  it("returns decimal places for float steps", () => {
    expect(stepPrecision(0.1)).toBe(1);
    expect(stepPrecision(0.01)).toBe(2);
  });
});

describe("alignMaxToStep", () => {
  describe("when range is evenly divisible by step", () => {
    it("returns rawMax unchanged", () => {
      expect(alignMaxToStep(16384, 256, 256)).toBe(16384);
    });

    it("handles float steps", () => {
      expect(alignMaxToStep(2, 0, 0.1)).toBe(2);
      expect(alignMaxToStep(1, 0, 0.01)).toBe(1);
    });
  });

  describe("when range is not divisible by step", () => {
    it("snaps down to nearest aligned value", () => {
      expect(alignMaxToStep(16385, 256, 256)).toBe(16384);
      expect(alignMaxToStep(4000, 256, 256)).toBe(3840);
    });

    it("handles float steps", () => {
      expect(alignMaxToStep(1.5, 0, 0.1)).toBe(1.5);
      expect(alignMaxToStep(1.55, 0, 0.1)).toBe(1.5);
    });
  });

  describe("when rawMax is less than or equal to min", () => {
    it("returns min + step when rawMax is below min", () => {
      expect(alignMaxToStep(100, 256, 256)).toBe(512);
    });

    it("returns min + step when rawMax equals min", () => {
      expect(alignMaxToStep(256, 256, 256)).toBe(512);
    });

    it("returns min + step when rawMax is zero", () => {
      expect(alignMaxToStep(0, 256, 256)).toBe(512);
    });

    it("returns min + step for float params", () => {
      expect(alignMaxToStep(0, 0, 0.1)).toBe(0.1);
    });
  });
});
