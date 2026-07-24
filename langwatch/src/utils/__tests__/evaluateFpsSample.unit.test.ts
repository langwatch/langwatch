import { describe, it, expect } from "vitest";
import { evaluateFpsSample } from "../evaluateFpsSample";

describe("evaluateFpsSample()", () => {
  describe("when the sampled rate is below the floor", () => {
    /** @scenario "A frame rate below the floor is reported as struggling" */
    it("reports the device as struggling", () => {
      const isStruggling = evaluateFpsSample({
        frames: 40,
        elapsedMs: 1500,
        minFps: 50,
      });

      expect(isStruggling).toBe(true);
    });
  });

  describe("when the sampled rate is at or above the floor", () => {
    /** @scenario "A frame rate at or above the floor is reported as smooth" */
    it("reports the device as smooth", () => {
      const isStruggling = evaluateFpsSample({
        frames: 90,
        elapsedMs: 1500,
        minFps: 50,
      });

      expect(isStruggling).toBe(false);
    });

    it("reports smooth when the rate lands exactly on the floor", () => {
      const isStruggling = evaluateFpsSample({
        frames: 75,
        elapsedMs: 1500,
        minFps: 50,
      });

      expect(isStruggling).toBe(false);
    });
  });

  describe("when no frames were observed in the window", () => {
    /** @scenario "A sample window with no observed frames is reported as struggling" */
    it("reports the device as struggling", () => {
      const isStruggling = evaluateFpsSample({
        frames: 0,
        elapsedMs: 1500,
        minFps: 50,
      });

      expect(isStruggling).toBe(true);
    });
  });

  describe("when elapsedMs is zero", () => {
    it("reports the device as struggling instead of dividing by zero", () => {
      const isStruggling = evaluateFpsSample({
        frames: 0,
        elapsedMs: 0,
        minFps: 50,
      });

      expect(isStruggling).toBe(true);
    });
  });
});
