/**
 * A board's daily run in words: its choices, when it runs, how the last run ended and when
 * a board offers it.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import {
  INSIGHT_RUN_SKIP_REASONS,
  INSIGHT_SCHEDULE_STATES,
  type InsightRunReason,
} from "@langwatch/insight-contract";
import { describe, expect, it } from "vitest";

import {
  defaultRunSettings,
  hourWords,
  type InsightLastRun,
  lastRunWords,
  RUN_HOURS,
  RUN_MAXIMUMS,
  runMaximum,
  runTimeWords,
  scheduleWords,
  shouldOfferDailyInsights,
  SKIP_REASON_WORDS,
  zoneChoices,
  zoneLabel,
} from "../daily-run.ts";

const DAY_MS = 86_400_000;
/** 12:34 in Amsterdam, in summer: the same calendar day there as in UTC. */
const NOW = Date.UTC(2026, 6, 9, 10, 34);
const AMSTERDAM = "Europe/Amsterdam";

function lastRun(overrides: Partial<InsightLastRun> = {}): InsightLastRun {
  return {
    at: NOW,
    outcome: "nothing",
    reason: null,
    filedCount: 0,
    conversationId: null,
    ...overrides,
  };
}

const words = (overrides: Partial<InsightLastRun>) =>
  lastRunWords({ lastRun: lastRun(overrides), now: NOW, timezone: AMSTERDAM });

describe("given the daily run's choices", () => {
  describe("when they are listed", () => {
    /** @scenario "A daily run takes any hour, a time zone and one of four maximums" */
    it("offers every hour of the day and the maximums 1, 3, 5 and 10", () => {
      expect(RUN_HOURS.map(hourWords)).toHaveLength(24);
      expect(hourWords(RUN_HOURS[0]!)).toBe("00:00");
      expect(hourWords(RUN_HOURS.at(-1)!)).toBe("23:00");
      expect([...RUN_MAXIMUMS]).toEqual([1, 3, 5, 10]);
    });

    /** @scenario "A daily run takes any hour, a time zone and one of four maximums" */
    it("starts a board at 09:00, the reader's own zone and at most 3", () => {
      expect(defaultRunSettings({ timezone: AMSTERDAM })).toEqual({
        hour: 9,
        timezone: AMSTERDAM,
        maxInsights: 3,
      });
    });

    /** @scenario "A daily run takes any hour, a time zone and one of four maximums" */
    it("reads a maximum the schedule does not take as the default", () => {
      expect(runMaximum(10)).toBe(10);
      expect(runMaximum(4)).toBe(3);
    });

    /** @scenario "A daily run takes any hour, a time zone and one of four maximums" */
    it("lists the reader's zone first and keeps a zone the run already has", () => {
      const own = zoneChoices({ own: AMSTERDAM, current: AMSTERDAM });
      expect(own.own).toBe(AMSTERDAM);
      expect(own.others).not.toContain(AMSTERDAM);
      expect(own.others).toContain("UTC");

      const kept = zoneChoices({ own: AMSTERDAM, current: "Pacific/Auckland" });
      expect(kept.others[0]).toBe("Pacific/Auckland");
    });

    /** @scenario "A daily run takes any hour, a time zone and one of four maximums" */
    it("names a zone by its place and its offset on the day", () => {
      expect(zoneLabel({ zone: AMSTERDAM, now: NOW })).toBe("Amsterdam time (UTC+2)");
      expect(zoneLabel({ zone: "America/Los_Angeles", now: NOW })).toBe("Los Angeles time (UTC-7)");
      expect(zoneLabel({ zone: "Asia/Kolkata", now: NOW })).toBe("Kolkata time (UTC+5:30)");
      expect(zoneLabel({ zone: "UTC", now: NOW })).toBe("UTC");
    });
  });
});

describe("given a run set for 9 in Europe/Amsterdam", () => {
  const settings = { hour: 9, timezone: AMSTERDAM, maxInsights: 3 } as const;

  describe("when its time is put in words", () => {
    /** @scenario "A run time is said as around its hour" */
    it("reads around 09:00 Amsterdam time", () => {
      expect(runTimeWords(settings)).toBe("around 09:00 Amsterdam time");
    });

    /** @scenario "A run time is said as around its hour" */
    it("says so in the schedule sentence, with the most it files", () => {
      expect(scheduleWords({ settings, hasWidgets: true })).toBe(
        "Langy reads this board for you every day around 09:00 Amsterdam time and files what stands out, at most 3 insights per run.",
      );
      expect(
        scheduleWords({ settings: { ...settings, maxInsights: 1 }, hasWidgets: true }),
      ).toMatch(/at most 1 insight per run\.$/);
    });
  });

  describe("when the board has no widgets", () => {
    /** @scenario "A board that is on with no widgets waits" */
    it("says there is nothing to read", () => {
      expect(scheduleWords({ settings, hasWidgets: false })).toBe(
        "This board has no widgets, so Langy has nothing to read. Add a widget and the next run reads it.",
      );
    });
  });
});

describe("given a board that is on", () => {
  describe("when no run settled yet", () => {
    /** @scenario "The dropdown says how the last run ended" */
    it("says no run yet", () => {
      expect(lastRunWords({ lastRun: null, now: NOW, timezone: AMSTERDAM })).toBe("No run yet.");
    });
  });

  describe("when the last run was today", () => {
    /** @scenario "The dropdown says how the last run ended" */
    it("names what it filed, at the time in the run's own zone", () => {
      expect(words({ outcome: "filed", filedCount: 2 })).toBe("Ran 12:34 · filed 2 new");
    });

    /** @scenario "The dropdown says how the last run ended" */
    it("says nothing new for a run Langy found no news in", () => {
      expect(words({ outcome: "nothing" })).toBe("Ran 12:34 · nothing new");
    });

    /** @scenario "The dropdown says how the last run ended" */
    it.each<InsightRunReason | null>(["turn_failed", "timeout", "rate_limited", null])(
      "says a failed run filed nothing and the next one tries again (%s)",
      (reason) => {
        expect(words({ outcome: "failed", reason })).toBe(
          "Failed 12:34 · nothing was filed, and the next run tries again",
        );
      },
    );

    /** @scenario "The dropdown says how the last run ended" */
    it.each(INSIGHT_RUN_SKIP_REASONS)("says a run skipped as %s did not run, and why", (reason) => {
      expect(SKIP_REASON_WORDS[reason]).not.toBe("");
      expect(words({ outcome: "skipped", reason })).toBe(
        `Did not run 12:34 · ${SKIP_REASON_WORDS[reason]}`,
      );
    });

    /** @scenario "The dropdown says how the last run ended" */
    it("has words of its own for every skip reason", () => {
      const said = INSIGHT_RUN_SKIP_REASONS.map((reason) => SKIP_REASON_WORDS[reason]);
      expect(new Set(said).size).toBe(INSIGHT_RUN_SKIP_REASONS.length);
    });

    /** @scenario "The dropdown says how the last run ended" */
    it("still answers for a skipped run that names no skip reason", () => {
      expect(words({ outcome: "skipped", reason: null })).toBe(
        "Did not run 12:34 · nothing was filed",
      );
    });

    /** @scenario "A From LangWatch board takes the control and is named by its template id" */
    it("says calmly that Langy cannot read a From LangWatch board yet", () => {
      expect(words({ outcome: "skipped", reason: "template_board" })).toBe(
        "Did not run 12:34 · Langy cannot read From LangWatch boards yet",
      );
    });
  });

  describe("when the last run was on an earlier day", () => {
    /** @scenario "The dropdown says how the last run ended" */
    it("names the day in place of the time", () => {
      expect(words({ outcome: "filed", filedCount: 1, at: NOW - 2 * DAY_MS })).toBe(
        "Ran Jul 7 · filed 1 new",
      );
    });
  });
});

describe("given a board that opened with widgets, without widgets, or while its widgets load", () => {
  describe("when the person is undecided, said no or turned it on", () => {
    /** @scenario "A board offers once per visit and never after an answer" */
    it("offers only to an undecided person on a board that opened with a widget", () => {
      const offered = INSIGHT_SCHEDULE_STATES.flatMap((state) =>
        [void 0, 0, 1, 4].map((widgetCountAtOpen) => ({
          state,
          widgetCountAtOpen,
          offers: shouldOfferDailyInsights({ state, widgetCountAtOpen, closedThisVisit: false }),
        })),
      ).filter(({ offers }) => offers);

      expect(offered.map(({ state, widgetCountAtOpen }) => [state, widgetCountAtOpen])).toEqual([
        ["undecided", 1],
        ["undecided", 4],
      ]);
    });

    /** @scenario "A board offers once per visit and never after an answer" */
    it("does not offer again in a visit where the offer was closed", () => {
      expect(
        shouldOfferDailyInsights({
          state: "undecided",
          widgetCountAtOpen: 4,
          closedThisVisit: true,
        }),
      ).toBe(false);
    });
  });
});
