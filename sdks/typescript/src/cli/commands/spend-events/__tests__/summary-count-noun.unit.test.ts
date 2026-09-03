import { describe, expect, it } from "vitest";

import { summaryCountNoun } from "../summary";

/**
 * The line printed after a summaries walk states how many of something the
 * window held. On a reconciliation surface that sentence is a claim about the
 * data, so it has to name what was actually counted: with two dimensions or a
 * time bucket, a row is a combination and no single dimension's noun is true
 * of it.
 */
describe("given the count printed after a summaries walk", () => {
  describe("when one dimension is grouped and no bucket is set", () => {
    it("names that dimension", () => {
      expect(summaryCountNoun({ groupBy: ["model"] })).toBe("models");
      expect(summaryCountNoun({ groupBy: ["end_user"], bucket: "none" })).toBe("end users");
    });

    it("falls back to a neutral noun for a dimension it has no label for", () => {
      expect(summaryCountNoun({ groupBy: ["something_new"] })).toBe("groups");
    });
  });

  describe("when a second dimension is grouped", () => {
    it("counts rows rather than the first dimension", () => {
      // Twelve model-by-provider rows are not twelve models, and reporting
      // them as models overstates how many the window held.
      expect(summaryCountNoun({ groupBy: ["model", "provider"] })).toBe("rows");
    });
  });

  describe("when a time bucket is added", () => {
    it("counts rows even on a single dimension", () => {
      // One model over 24 hours is 24 rows and one model.
      expect(summaryCountNoun({ groupBy: ["model"], bucket: "hour" })).toBe("rows");
    });
  });
});
