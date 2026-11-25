/** @see specs/langy/langy-trace-explorer-actions.feature */
import { describe, expect, it } from "vitest";

import { lensKeepsTheResultSet } from "../explorer-scope.slice.ts";

describe("lensKeepsTheResultSet", () => {
  describe("when the lens shows every trace as flat rows with no filter of its own", () => {
    it("is kept, so the link opens that lens", () => {
      expect(lensKeepsTheResultSet({ grouping: "flat", filterText: "" })).toBe(true);
      expect(lensKeepsTheResultSet({ grouping: "flat", filterText: "   " })).toBe(true);
    });
  });

  describe("when the lens carries a filter of its own", () => {
    /** @scenario "A lens that would change the result set is not kept" */
    it("is not kept, because it would narrow the set the link describes", () => {
      expect(lensKeepsTheResultSet({ grouping: "flat", filterText: "status:error" })).toBe(false);
    });
  });

  describe("when the lens is grouped", () => {
    /** @scenario "A lens that would change the result set is not kept" */
    it("is not kept, because it would count groups where the link counted traces", () => {
      expect(lensKeepsTheResultSet({ grouping: "by-user", filterText: "" })).toBe(false);
    });
  });

  describe("when no lens is active", () => {
    it("is not kept, so the link opens the default lens", () => {
      expect(lensKeepsTheResultSet(undefined)).toBe(false);
    });
  });
});
