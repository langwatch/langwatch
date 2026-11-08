import { describe, expect, it } from "vitest";

import { AGGREGATE_HISTORY_NOTE, emptyContent, emptyStateActions } from "../empty-filter-state.tsx";

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

  describe("given an eval chip with no run for this window", () => {
    describe("when the table has no rows", () => {
      /** @scenario "An empty table under an unjudged chip says these results are not judged" */
      it("says the results are not judged instead of claiming nothing matches", () => {
        const content = emptyContent({
          activeLensId: "all-traces",
          hasFilters: true,
          rangeHours: 24,
          isJudging: false,
          hasUnjudgedEval: true,
        });
        expect(content.title).toBe("These results are not judged yet");
        expect(content.description).toContain("Judge these results");
        // A chip can arrive with no run at all, from a shared link or a saved
        // lens, so the sentence must not assert that one ran over another scope.
        expect(content.description).not.toContain("covered a different");
      });
    });
  });

  describe("given an eval chip whose run failed", () => {
    describe("when the table has no rows", () => {
      /** @scenario "An empty table under a failed run says the run failed" */
      it("says the eval did not finish, with the reason", () => {
        const content = emptyContent({
          activeLensId: "all-traces",
          hasFilters: true,
          rangeHours: 24,
          isJudging: false,
          failedEvalMessage: "Instant Evals could not reach LangWatch. Nothing was charged.",
        });
        expect(content.title).toBe("The Instant Eval did not finish");
        expect(content.description).toContain("could not reach LangWatch");
        expect(content.title).not.toContain("Nothing matches");
        expect(content.description).not.toContain("still judging");
      });

      /** @scenario "An empty table under a failed run says the run failed" */
      it("offers Retry first", () => {
        const retry = () => {};
        const actions = emptyStateActions({
          activeLensId: "all-traces",
          hasFilters: true,
          isJudging: false,
          rangeHours: 24 * 30,
          unjudgedChip: null,
          clearAll: () => {},
          selectLens: () => {},
          setTimeRange: () => {},
          judgeTheseResults: () => {},
          retryFailedEval: retry,
        });
        expect(actions[0]).toMatchObject({ label: "Retry", primary: true, onClick: retry });
        expect(actions.find((action) => action.label === "Clear filters")?.primary).toBe(false);
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

  describe("given an aggregate project", () => {
    describe("when its trace list is empty", () => {
      /** @scenario "An empty aggregate says only a department rule starts at the join date" */
      it("adds a note that only a department aggregate starts at the join date", () => {
        const content = emptyContent({
          activeLensId: "all-traces",
          hasFilters: false,
          rangeHours: 24 * 30,
          isJudging: false,
          isAggregate: true,
        });
        expect(content.note).toBe(AGGREGATE_HISTORY_NOTE);
        expect(content.note).toContain("built from a department");
        expect(content.note).toContain("from the day that member joined it");
        expect(content.note).toContain("Older traces stay in the member project");
      });

      /** @scenario "An empty aggregate says only a department rule starts at the join date" */
      it("never claims every aggregate starts when it was created or joined", () => {
        const content = emptyContent({
          activeLensId: "all-traces",
          hasFilters: false,
          rangeHours: 24 * 30,
          isJudging: false,
          isAggregate: true,
        });
        const text = `${content.title} ${content.description} ${content.note}`;
        expect(text).not.toMatch(/since this aggregate was created/i);
        expect(text).not.toMatch(/this aggregate (only )?shows member traces from/i);
      });

      /** @scenario "An empty aggregate says only a department rule starts at the join date" */
      it("gives the note on every lens, with or without filters", () => {
        for (const activeLensId of ["errors", "conversations", "all-traces"]) {
          for (const hasFilters of [true, false]) {
            const content = emptyContent({
              activeLensId,
              hasFilters,
              rangeHours: 24,
              isJudging: false,
              isAggregate: true,
            });
            expect(content.note).toBe(AGGREGATE_HISTORY_NOTE);
          }
        }
      });

      /** @scenario "An empty aggregate says only a department rule starts at the join date" */
      it("keeps the lens's own title and the advice to widen the window", () => {
        const content = emptyContent({
          activeLensId: "all-traces",
          hasFilters: true,
          rangeHours: 24 * 7,
          isJudging: false,
          isAggregate: true,
        });
        expect(content.title).toBe("Nothing matches these filters");
        expect(content.description).toContain("Try widening the window");
      });
    });

    describe("when an Instant Eval is still judging", () => {
      it("leaves the judging message alone, since the run explains the empty table", () => {
        const content = emptyContent({
          activeLensId: "all-traces",
          hasFilters: true,
          rangeHours: 24,
          isJudging: true,
          isAggregate: true,
        });
        expect(content.title).toBe("No matches yet");
        expect(content.note).toBeUndefined();
      });
    });
  });

  describe("given a plain project", () => {
    describe("when its trace list is empty", () => {
      /** @scenario "An empty aggregate says only a department rule starts at the join date" */
      it("says nothing about aggregates", () => {
        const content = emptyContent({
          activeLensId: "all-traces",
          hasFilters: false,
          rangeHours: 24 * 30,
          isJudging: false,
        });
        expect(content.note).toBeUndefined();
        expect(`${content.title} ${content.description}`).not.toMatch(/aggregate/i);
      });
    });
  });
});
