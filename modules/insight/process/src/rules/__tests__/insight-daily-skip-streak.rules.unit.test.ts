/**
 * @vitest-environment node
 * The count of skipped days, folded from runs' outcomes alone: in order, twice and late.
 * @see modules/insight/specs/insight-daily-run-hardening.feature
 */

import type { InsightRunOutcome, InsightRunReason } from "@langwatch/insight-contract";
import { describe, expect, it } from "vitest";

import {
  foldSkipStreak,
  isLastSkippedDay,
  NO_SKIP_STREAK,
  restartSkipStreak,
  scheduledRunId,
  type SkipStreak,
} from "../insight-daily-skip-streak.rules.ts";

const DAY = 24 * 60 * 60_000;
const DAY_ONE = Date.UTC(2026, 9, 10, 9, 37);

/** The scheduled run of a day, counted from the first. */
const scheduled = (
  day: number,
  outcome: InsightRunOutcome,
  reason: InsightRunReason | null = null,
) => {
  const slot = DAY_ONE + day * DAY;
  return { runId: scheduledRunId({ slot }), slot, outcome, reason };
};

/** An operator's run, asked for some hours after a day's slot. */
const requested = (day: number, outcome: InsightRunOutcome) => ({
  runId: "insightrun_request",
  slot: DAY_ONE + day * DAY + 3 * 60 * 60_000,
  outcome,
  reason: null,
});

type Run = Parameters<typeof foldSkipStreak>[0]["run"];

const fold = (runs: readonly Run[], from: SkipStreak = NO_SKIP_STREAK) =>
  runs.reduce((streak, run) => foldSkipStreak({ streak, run }), from);

const skippedFor = (days: number) =>
  fold(Array.from({ length: days }, (_, day) => scheduled(day, "skipped")));

describe("given scheduled runs on four days", () => {
  describe("when they end skipped, skipped, filed and skipped", () => {
    /** @scenario "The skipped days are counted from the runs' outcomes" */
    it("counts 1, then 2, then 0, then 1", () => {
      const runs = [
        scheduled(0, "skipped"),
        scheduled(1, "skipped"),
        scheduled(2, "filed"),
        scheduled(3, "skipped"),
      ];

      const counts = runs.map((_, at) => fold(runs.slice(0, at + 1)).count);

      expect(counts).toEqual([1, 2, 0, 1]);
    });

    it.each(["nothing", "failed"] as const)("starts over on a run that ends %s", (outcome) => {
      const streak = fold([scheduled(3, outcome)], skippedFor(3));

      expect(streak).toEqual({ count: 0, slot: DAY_ONE + 3 * DAY });
    });
  });
});

describe("given a count of 3 skipped days", () => {
  describe("when the newest run's outcome is folded again", () => {
    /** @scenario "A run's outcome folded twice counts once" */
    it("still counts 3", () => {
      const streak = skippedFor(3);

      expect(fold([scheduled(2, "skipped")], streak)).toBe(streak);
      expect(fold([scheduled(2, "filed")], streak)).toBe(streak);
    });
  });

  describe("when the whole stream is folded again from the start", () => {
    it("counts what one fold counted", () => {
      const runs = [scheduled(0, "skipped"), scheduled(1, "filed"), scheduled(2, "skipped")];

      expect(fold(runs, fold(runs))).toEqual(fold(runs));
    });
  });
});

describe("given a count that already holds the run of a later day", () => {
  describe.each(["skipped", "filed"] as const)(
    "when an earlier day's run arrives %s",
    (outcome) => {
      /** @scenario "An outcome that arrives after a newer one changes nothing" */
      it("leaves the count as it was", () => {
        const streak = fold([scheduled(0, "skipped"), scheduled(2, "skipped")]);

        expect(fold([scheduled(1, outcome)], streak)).toBe(streak);
        expect(streak.count).toBe(2);
      });
    },
  );
});

describe("given a count of 6 skipped days", () => {
  describe("when an operator's run is skipped", () => {
    /** @scenario "An operator's skipped run is no skipped day" */
    it("still counts 6, and starts over when an operator's run files", () => {
      const streak = skippedFor(6);

      expect(fold([requested(5, "skipped")], streak)).toBe(streak);
      expect(fold([requested(5, "filed")], streak).count).toBe(0);
    });
  });

  describe("when a run on a From LangWatch board is skipped", () => {
    /** @scenario "A skipped run on a From LangWatch board is no skipped day" */
    it("still counts 6, on that day and on every day after", () => {
      const streak = skippedFor(6);
      const days = [6, 7, 8].map((day) => scheduled(day, "skipped", "template_board"));

      expect(fold(days, streak)).toBe(streak);
    });
  });

  describe("when the person turns the run on again", () => {
    it("starts the count over and still ignores the days already counted", () => {
      const restarted = restartSkipStreak(skippedFor(6));

      expect(restarted.count).toBe(0);
      expect(fold([scheduled(5, "skipped")], restarted)).toBe(restarted);
      expect(fold([scheduled(6, "skipped")], restarted).count).toBe(1);
    });
  });
});

describe("given a scheduled run that ends skipped", () => {
  it("is the day that turns the schedule off after 6 skipped days, and not after 5", () => {
    expect(isLastSkippedDay({ skippedDaysBefore: 5 })).toBe(false);
    expect(isLastSkippedDay({ skippedDaysBefore: 6 })).toBe(true);
    expect(isLastSkippedDay({ skippedDaysBefore: 9 })).toBe(true);
  });
});
