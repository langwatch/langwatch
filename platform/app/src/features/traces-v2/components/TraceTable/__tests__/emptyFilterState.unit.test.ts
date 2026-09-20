import { describe, expect, it } from "vitest";
import { emptyContent } from "../EmptyFilterState";

describe("emptyContent", () => {
  describe("given an Instant Eval that is still judging", () => {
    describe("when the table has no rows yet", () => {
      /** @scenario "An empty table during a run says matches are still coming" */
      it("says no matches yet instead of claiming nothing matches", () => {
        const content = emptyContent({
          activeLensId: "all-traces",
          hasFilters: true,
          rangeHours: 24 * 7,
          isJudging: true,
        });
        expect(content.title).toBe("No matches yet");
        expect(content.description).toContain("still judging");
        expect(content.title).not.toContain("Nothing matches");
      });

      /** @scenario "An empty table during a run says matches are still coming" */
      it("says so on every lens, since the chip judges whatever the lens lists", () => {
        for (const activeLensId of ["errors", "conversations", "all-traces"]) {
          expect(
            emptyContent({
              activeLensId,
              hasFilters: true,
              rangeHours: 24,
              isJudging: true,
            }).title,
          ).toBe("No matches yet");
        }
      });
    });
  });

  describe("given no run is judging", () => {
    describe("when a filter matches nothing", () => {
      it("says nothing matches these filters", () => {
        expect(
          emptyContent({
            activeLensId: "all-traces",
            hasFilters: true,
            rangeHours: 24 * 7,
            isJudging: false,
          }).title,
        ).toBe("Nothing matches these filters");
      });
    });
  });
});
