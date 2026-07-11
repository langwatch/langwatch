import { describe, expect, it } from "vitest";
import { estimateFiringRate } from "../firingRate";

describe("estimateFiringRate", () => {
  describe("when the query matches many traces", () => {
    it("reports an hourly rate above ~24/day", () => {
      // 700 matches / 7 days = 100/day ≈ 4/hour.
      expect(estimateFiringRate(700)).toBe("About 4 times an hour at this rate");
    });
  });

  describe("when the query matches a handful of traces a day", () => {
    it("reports a daily rate", () => {
      // 70 / 7 = 10 a day.
      expect(estimateFiringRate(70)).toBe("About 10 times a day at this rate");
    });

    it("singularises one a day", () => {
      expect(estimateFiringRate(7)).toBe("About 1 time a day at this rate");
    });
  });

  describe("when the query rarely matches", () => {
    it("falls back to a weekly rate", () => {
      expect(estimateFiringRate(3)).toBe("About 3 times a week at this rate");
    });

    it("singularises one a week", () => {
      expect(estimateFiringRate(1)).toBe("About 1 time a week at this rate");
    });
  });
});
