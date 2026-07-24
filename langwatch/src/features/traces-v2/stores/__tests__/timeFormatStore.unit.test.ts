// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { timeColumnSizing, useTimeFormatStore } from "../timeFormatStore";

const STORAGE_KEY = "langwatch:traces-v2:time-format:v1";

describe("timeFormatStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useTimeFormatStore.setState({ format: "relative" });
  });

  describe("given the Time column format", () => {
    describe("when set to relative", () => {
      it("persists the choice to localStorage", () => {
        useTimeFormatStore.getState().setFormat("relative");
        expect(localStorage.getItem(STORAGE_KEY)).toBe("relative");
      });
    });

    describe("when set to iso", () => {
      it("persists the choice to localStorage", () => {
        useTimeFormatStore.getState().setFormat("iso");
        expect(localStorage.getItem(STORAGE_KEY)).toBe("iso");
      });
    });
  });
});

describe("timeColumnSizing", () => {
  // A full ISO 8601 stamp is `2026-06-02T13:14:15.123Z` — 24 monospace
  // chars. Lock the rule that the ISO footprint is meaningfully wider than
  // the relative one so the timestamp can't clip when the user toggles.
  const ISO_SAMPLE = new Date(0).toISOString();

  describe("given the relative format", () => {
    it("returns the compact footprint", () => {
      expect(timeColumnSizing("relative")).toEqual({
        size: 68,
        minSize: 68,
        maxSize: 200,
      });
    });
  });

  describe("given the iso format", () => {
    const iso = timeColumnSizing("iso");

    it("returns a wider footprint than relative", () => {
      const relative = timeColumnSizing("relative");
      expect(iso.size).toBeGreaterThan(relative.size);
      expect(iso.minSize).toBeGreaterThan(relative.minSize);
    });

    it("is wide enough to hold a full ISO 8601 stamp without clipping", () => {
      // ~9px per monospace char at the table's font size is a safe lower
      // bound; the floor must clear the rendered stamp width.
      expect(iso.minSize).toBeGreaterThanOrEqual(ISO_SAMPLE.length * 8);
    });

    it("keeps minSize at or below the default size so the column opens wide", () => {
      expect(iso.minSize).toBeLessThanOrEqual(iso.size);
    });
  });

  // Mirrors TanStack's `column.getSize()` clamp:
  //   min(max(minSize, override ?? size), maxSize)
  // so a stale narrow manual resize from relative mode is floored back up
  // to the ISO minSize instead of clipping the timestamp.
  describe("when a persisted manual resize is applied on top of the footprint", () => {
    const clamp = (
      format: "relative" | "iso",
      override: number | undefined,
    ): number => {
      const { size, minSize, maxSize } = timeColumnSizing(format);
      return Math.min(Math.max(minSize, override ?? size), maxSize);
    };

    it("floors a stale narrow relative-mode width up to the ISO minimum", () => {
      const staleRelativeWidth = timeColumnSizing("relative").size;
      expect(clamp("iso", staleRelativeWidth)).toBe(
        timeColumnSizing("iso").minSize,
      );
    });

    it("preserves a deliberate wide ISO-mode resize", () => {
      const { minSize, maxSize } = timeColumnSizing("iso");
      const userWidth = Math.round((minSize + maxSize) / 2);
      expect(clamp("iso", userWidth)).toBe(userWidth);
    });

    it("preserves a deliberate relative-mode resize", () => {
      expect(clamp("relative", 150)).toBe(150);
    });
  });
});
