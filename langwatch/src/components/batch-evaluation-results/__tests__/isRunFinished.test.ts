import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INTERRUPTED_THRESHOLD_MS,
  isRunFinished,
} from "../isRunFinished";

describe("isRunFinished", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when finishedAt is set", () => {
    it("returns true", () => {
      expect(isRunFinished({ finishedAt: 1705312800000 })).toBe(true);
    });
  });

  describe("when stoppedAt is set", () => {
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

  describe("when updatedAt is recent (< 5 minutes)", () => {
    it("returns false", () => {
      const twoMinutesAgo = Date.now() - 2 * 60 * 1000;
      expect(isRunFinished({ updatedAt: twoMinutesAgo })).toBe(false);
    });
  });

  describe("when updatedAt is stale (> 5 minutes)", () => {
    it("returns true (interrupted)", () => {
      const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
      expect(isRunFinished({ updatedAt: tenMinutesAgo })).toBe(true);
    });
  });

  describe("when updatedAt is exactly at threshold", () => {
    it("returns false (threshold is exclusive)", () => {
      const exactlyAtThreshold = Date.now() - INTERRUPTED_THRESHOLD_MS;
      expect(isRunFinished({ updatedAt: exactlyAtThreshold })).toBe(false);
    });
  });

  describe("when updatedAt is just past threshold", () => {
    it("returns true", () => {
      const justPastThreshold = Date.now() - INTERRUPTED_THRESHOLD_MS - 1;
      expect(isRunFinished({ updatedAt: justPastThreshold })).toBe(true);
    });
  });

  describe("when all timestamps are null or undefined", () => {
    it("returns false", () => {
      expect(isRunFinished({})).toBe(false);
      expect(
        isRunFinished({
          finishedAt: null,
          stoppedAt: null,
          updatedAt: null,
        }),
      ).toBe(false);
      expect(
        isRunFinished({
          finishedAt: undefined,
          stoppedAt: undefined,
          updatedAt: undefined,
        }),
      ).toBe(false);
    });
  });

  it("exports INTERRUPTED_THRESHOLD_MS as 5 minutes in milliseconds", () => {
    expect(INTERRUPTED_THRESHOLD_MS).toBe(5 * 60 * 1000);
  });
});
