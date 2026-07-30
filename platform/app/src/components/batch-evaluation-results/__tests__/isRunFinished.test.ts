import { describe, expect, it } from "vitest";
import { INTERRUPTED_THRESHOLD_MS, isRunFinished } from "../isRunFinished";

describe("isRunFinished", () => {
  describe("when finishedAt is set", () => {
    it("returns true", () => {
      expect(isRunFinished({ finishedAt: 1705312800000 })).toBe(true);
    });
  });

  describe("when stoppedAt is set", () => {
    /** @scenario Show stopped indicator for stopped run */
    it("returns true", () => {
      expect(isRunFinished({ stoppedAt: 1705312800000 })).toBe(true);
    });
  });

  describe("when both finishedAt and stoppedAt are set", () => {
    it("returns true", () => {
      expect(
        isRunFinished({ finishedAt: 1705312800000, stoppedAt: 1705312800000 }),
      ).toBe(true);
    });
  });

  describe("given no explicit finishedAt or stoppedAt", () => {
    describe("when progress has reached total", () => {
      /** @scenario A run running at 50 of 50 reads as finished immediately */
      it("returns true without waiting on any wall clock", () => {
        expect(isRunFinished({ progress: 50, total: 50 })).toBe(true);
      });

      it("returns true when progress has overshot total", () => {
        expect(isRunFinished({ progress: 51, total: 50 })).toBe(true);
      });
    });

    describe("when progress is behind total", () => {
      /** @scenario A run finished at 47 of 50 is the bug this closes */
      it("returns false, even though the wall-clock heuristic used to mark it finished", () => {
        expect(isRunFinished({ progress: 47, total: 50 })).toBe(false);
      });
    });

    describe("when progress or total is not known yet", () => {
      /** @scenario Show running indicator for in-progress run */
      it("returns false", () => {
        expect(isRunFinished({})).toBe(false);
        expect(isRunFinished({ progress: null, total: 50 })).toBe(false);
        expect(isRunFinished({ progress: 0, total: null })).toBe(false);
      });
    });
  });

  describe("when all fields are null or undefined", () => {
    it("returns false", () => {
      expect(
        isRunFinished({
          finishedAt: null,
          stoppedAt: null,
          progress: null,
          total: null,
        }),
      ).toBe(false);
      expect(
        isRunFinished({
          finishedAt: undefined,
          stoppedAt: undefined,
          progress: undefined,
          total: undefined,
        }),
      ).toBe(false);
    });
  });

  it("exports INTERRUPTED_THRESHOLD_MS as 5 minutes in milliseconds", () => {
    expect(INTERRUPTED_THRESHOLD_MS).toBe(5 * 60 * 1000);
  });
});
