/**
 * @see specs/components/adaptive-graphics-quality.feature
 */
import { describe, expect, it } from "vitest";
import { evaluateFpsSample } from "../evaluate-fps-sample";

describe("evaluateFpsSample()", () => {
  describe("given a sample window below the floor", () => {
    /** @scenario A frame rate below the floor is reported as struggling */
    it("reports the device as struggling", () => {
      expect(evaluateFpsSample({ frames: 40, elapsedMs: 1500, minFps: 50 })).toBe(true);
    });
  });

  describe("given a sample window at or above the floor", () => {
    /** @scenario A frame rate at or above the floor is reported as smooth */
    it("reports the device as smooth", () => {
      expect(evaluateFpsSample({ frames: 90, elapsedMs: 1500, minFps: 50 })).toBe(false);
    });
  });

  describe("given a sample window with no observed frames", () => {
    /** @scenario A sample window with no observed frames is reported as struggling */
    it("reports the device as struggling", () => {
      expect(evaluateFpsSample({ frames: 0, elapsedMs: 1500, minFps: 50 })).toBe(true);
    });
  });
});
