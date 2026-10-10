import { describe, expect, it } from "vitest";

import { countFinished, hasFinished, markFinished } from "../experiment-run-window.rules.ts";

describe("the run manager's finished-cell bitmap", () => {
  describe("given an empty bitmap", () => {
    it("reports no cell finished", () => {
      expect(hasFinished({ bitmap: "", ordinal: 0 })).toBe(false);
      expect(countFinished({ bitmap: "", from: 0, to: 100 })).toBe(0);
    });
  });

  describe("when cells across several bytes are marked", () => {
    const bitmap = [0, 7, 8, 4_999].reduce(
      (current, ordinal) => markFinished({ bitmap: current, ordinal }),
      "",
    );

    it("reports exactly those cells finished", () => {
      expect(
        [0, 1, 7, 8, 9, 4_998, 4_999].map((ordinal) => hasFinished({ bitmap, ordinal })),
      ).toEqual([true, false, true, true, false, false, true]);
    });

    it("counts only the finished cells inside the range", () => {
      expect(countFinished({ bitmap, from: 0, to: 8 })).toBe(2);
      expect(countFinished({ bitmap, from: 8, to: 5_000 })).toBe(2);
    });

    it("holds a 5,000-cell run in about a kilobyte", () => {
      expect(Buffer.from(bitmap, "base64").length).toBe(625);
    });
  });

  describe("when a finished cell is marked again", () => {
    it("changes nothing", () => {
      const once = markFinished({ bitmap: "", ordinal: 3 });

      expect(markFinished({ bitmap: once, ordinal: 3 })).toBe(once);
    });
  });
});
