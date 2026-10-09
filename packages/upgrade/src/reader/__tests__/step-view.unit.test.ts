import { describe, expect, it } from "vitest";

import { progressOf } from "../step-view.ts";

describe("progressOf", () => {
  describe("when the report carries done and total", () => {
    it("reads them as the step's progress", () => {
      expect(progressOf({ report: { done: 63, total: 100, cursor: "x" } })).toEqual({
        done: 63,
        total: 100,
      });
    });
  });

  describe("when the report lacks either key or holds no count", () => {
    it.each([null, { done: 3 }, { total: 9 }, { done: "3", total: 9 }, { done: 1, total: 0 }])(
      "reads no progress from %o",
      (report) => {
        expect(progressOf({ report })).toBeNull();
      },
    );
  });
});
