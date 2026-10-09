import { describe, expect, it } from "vitest";
import { emptyContent, emptyStateActions } from "../EmptyFilterState";

// Any window serves where the project is not an aggregate.
const ANY_WINDOW = { rangeFrom: 0, rangeTo: 0 };

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
          ...ANY_WINDOW,
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
              ...ANY_WINDOW,
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
          ...ANY_WINDOW,
        });
        expect(content.title).toBe("These results are not judged yet");
        expect(content.description).toContain("Judge these results");
        // A chip can arrive with no run at all, from a shared link or a saved
        // lens, so the sentence must not assert that one ran over another scope.
        expect(content.description).not.toContain("covered a different");
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
            ...ANY_WINDOW,
          }).title,
        ).toBe("Nothing matches these filters");
      });
    });
  });

  describe("given an aggregate project", () => {
    const DAY = 24 * 60 * 60 * 1000;
    // Midday UTC, so the date reads the same in every test timezone.
    const createdAt = Date.parse("2026-10-08T12:00:00Z");
    const lastSevenDays = {
      from: createdAt + DAY - 7 * DAY,
      to: createdAt + DAY,
    };
    const noop = () => undefined;
    const actionsFor = ({
      aggregateCreatedAt,
      hasFilters = false,
    }: {
      aggregateCreatedAt: number | null;
      hasFilters?: boolean;
    }) =>
      emptyStateActions({
        activeLensId: "all-traces",
        hasFilters,
        isJudging: false,
        // The last three days, which reach back before the aggregate existed.
        rangeHours: 24 * 3,
        rangeFrom: createdAt - 2 * DAY,
        aggregateCreatedAt,
        unjudgedChip: null,
        clearAll: noop,
        selectLens: noop,
        setTimeRange: noop,
        judgeTheseResults: noop,
      }).map((action) => action.label);

    describe("when the window reaches back before the aggregate was created", () => {
      /** @scenario "An empty aggregate says its traces start when it was created" */
      it("says member traces show from the day it was created, and older ones stay in each member", () => {
        const content = emptyContent({
          activeLensId: "all-traces",
          hasFilters: false,
          rangeHours: 24 * 7,
          isJudging: false,
          aggregateCreatedAt: createdAt,
          rangeFrom: lastSevenDays.from,
          rangeTo: lastSevenDays.to,
        });
        expect(content.title).toBe("Nothing since this aggregate was created");
        expect(content.description).toContain("from 8 October 2026");
        expect(content.description).toContain("Older traces stay in each");
        expect(content.description).not.toContain("wider time window");
      });

      /** @scenario "An empty aggregate says its traces start when it was created" */
      it("says the window ends before the aggregate existed when it does", () => {
        const content = emptyContent({
          activeLensId: "all-traces",
          hasFilters: false,
          rangeHours: 24,
          isJudging: false,
          aggregateCreatedAt: createdAt,
          rangeFrom: createdAt - 3 * DAY,
          rangeTo: createdAt - 2 * DAY,
        });
        expect(content.title).toBe(
          "This window ends before the aggregate was created",
        );
        expect(content.description).toContain("from 8 October 2026");
      });

      /** @scenario "An empty aggregate says its traces start when it was created" */
      it("offers no wider window, since a wider one reaches only further back", () => {
        expect(actionsFor({ aggregateCreatedAt: createdAt })).toEqual([]);
      });

      describe("when a filter matches nothing", () => {
        /** @scenario "An empty aggregate says its traces start when it was created" */
        it("advises clearing the filters but not widening the window it no longer offers", () => {
          const content = emptyContent({
            activeLensId: "all-traces",
            hasFilters: true,
            rangeHours: 24 * 7,
            isJudging: false,
            aggregateCreatedAt: createdAt,
            rangeFrom: lastSevenDays.from,
            rangeTo: lastSevenDays.to,
          });
          expect(content.title).toBe("Nothing matches these filters");
          expect(content.description).toContain("from 8 October 2026");
          expect(content.description).toContain("clearing all filters");
          expect(content.description).not.toContain("widening");
          expect(
            actionsFor({ aggregateCreatedAt: createdAt, hasFilters: true }),
          ).toEqual(["Clear filters"]);
        });

        /** @scenario "An empty aggregate says its traces start when it was created" */
        it("says the window ends before the aggregate existed on every lens", () => {
          for (const activeLensId of [
            "all-traces",
            "errors",
            "conversations",
          ]) {
            expect(
              emptyContent({
                activeLensId,
                hasFilters: true,
                rangeHours: 24,
                isJudging: false,
                aggregateCreatedAt: createdAt,
                rangeFrom: createdAt - 3 * DAY,
                rangeTo: createdAt - 2 * DAY,
              }).title,
            ).toBe("This window ends before the aggregate was created");
          }
        });
      });
    });

    describe("when the window starts after the aggregate was created", () => {
      it("keeps the plain wider-window hint, since the window is the cause", () => {
        const content = emptyContent({
          activeLensId: "all-traces",
          hasFilters: false,
          rangeHours: 24 * 7,
          isJudging: false,
          aggregateCreatedAt: createdAt - 30 * DAY,
          rangeFrom: lastSevenDays.from,
          rangeTo: lastSevenDays.to,
        });
        expect(content.title).toBe("Nothing in this range");
      });
    });

    describe("when the project is a plain project", () => {
      /** @scenario "An empty aggregate says its traces start when it was created" */
      it("still suggests and offers a wider time window", () => {
        const content = emptyContent({
          activeLensId: "all-traces",
          hasFilters: false,
          rangeHours: 24 * 7,
          isJudging: false,
          aggregateCreatedAt: null,
          rangeFrom: lastSevenDays.from,
          rangeTo: lastSevenDays.to,
        });
        expect(content.title).toBe("Nothing in this range");
        expect(content.description).toContain("wider time window");
        expect(actionsFor({ aggregateCreatedAt: null })).toEqual([
          "Last 7 days",
          "Last 30 days",
        ]);
      });

      it("still advises widening the window when a filter matches nothing", () => {
        const content = emptyContent({
          activeLensId: "all-traces",
          hasFilters: true,
          rangeHours: 24 * 7,
          isJudging: false,
          aggregateCreatedAt: null,
          rangeFrom: lastSevenDays.from,
          rangeTo: lastSevenDays.to,
        });
        expect(content.description).toContain("Try widening the window");
      });
    });
  });
});
