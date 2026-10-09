/**
 * What a filing must carry before it reaches the module.
 * @see modules/insight/specs/insight-inbox.feature
 */

import { describe, expect, it } from "vitest";

import { fileInsightInputSchema } from "../insight.ts";

const FILING = {
  projectId: "project-1",
  title: "Checkout errors doubled",
  body: "Checkout errors doubled overnight.",
  tone: "bad",
};

describe("given a file request", () => {
  describe("when its title is empty", () => {
    /** @scenario "An insight without a title is refused" */
    it("refuses it with a field error on the title, blank or only spaces", () => {
      for (const title of ["", "   "]) {
        const result = fileInsightInputSchema.safeParse({ ...FILING, title });

        expect(result.success).toBe(false);
        expect(result.error?.issues.map((issue) => issue.path)).toEqual([["title"]]);
      }
    });
  });

  describe("when it carries a title, a body and a tone", () => {
    it("is accepted, staying true for 7 days unless it says otherwise", () => {
      expect(fileInsightInputSchema.parse(FILING)).toEqual({ ...FILING, validDays: 7 });
    });
  });
});
