/**
 * @vitest-environment node
 * The skipped days as the schedule's process keeps them: what a wake hands its run, what an
 * off leaves behind, and how an instance stored before either reads. Pure handlers, no store.
 * @see modules/insight/specs/insight-daily-run-hardening.feature
 */

import { buildIntentAccessor } from "@langwatch/eventing";
import {
  INSIGHT_DAILY_RUN_LEASE_MS,
  INSIGHT_DAILY_RUN_MAX_ATTEMPTS,
  type InsightRunOutcome,
  type InsightRunSettledEventData,
  type InsightScheduleConfiguredEventData,
} from "@langwatch/insight-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { dailyScheduleId } from "../../rules/insight-daily-run.rules.ts";
import { dailyScheduleMinute } from "../../rules/insight-daily-schedule.rules.ts";
import { runBoardIntentSchema } from "../insight-daily-run.intent.ts";
import {
  INITIAL_INSIGHT_DAILY_RUN_STATE,
  type InsightDailyRunState,
  insightDailyRunStateSchema,
  insightRunRequested,
  insightRunSettled,
  insightScheduleConfigured,
  insightScheduleRearmRequested,
  insightScheduleTurnedOff,
  insightScheduleWake,
} from "../insight-daily-run.process.ts";

const BOARD = { kind: "dashboard", id: "dashboard-1", name: "Costs" } as const;
const OWNER = { projectId: "project-1", userId: "user-1", board: BOARD };
const SCHEDULE = { scheduleId: dailyScheduleId(OWNER), userId: OWNER.userId, board: BOARD };
const SETTINGS: InsightScheduleConfiguredEventData = {
  ...SCHEDULE,
  hour: 9,
  timezone: "UTC",
  maxInsights: 3,
};
const MM = String(dailyScheduleMinute({ scheduleId: SCHEDULE.scheduleId })).padStart(2, "0");
const DAY = 24 * 60 * 60_000;
const FIRST_SLOT = Temporal.Instant.from(`2026-10-10T09:${MM}:00Z`).epochMilliseconds;
const EARLY = FIRST_SLOT - 2 * 60 * 60_000;

function context({ at, now = at }: { at: number; now?: number }) {
  return {
    at,
    now,
    key: SCHEDULE.scheduleId,
    projectId: OWNER.projectId,
    intent: buildIntentAccessor({
      runBoard: { schema: runBoardIntentSchema, run: async () => {} },
    }),
  };
}

const settled = (runId: string, slot: number, outcome: InsightRunOutcome) =>
  ({
    ...SCHEDULE,
    runId,
    slot,
    outcome,
    reason: outcome === "skipped" ? "no_access" : null,
    filedCount: 0,
    renewedCount: 0,
    conversationId: null,
  }) satisfies InsightRunSettledEventData;

const turnedOn = () =>
  insightScheduleConfigured(INITIAL_INSIGHT_DAILY_RUN_STATE, SETTINGS, context({ at: EARLY }))
    .state;

/** Wakes the schedule on a day and settles the run it started, with the outcome named. */
function runDay(state: InsightDailyRunState, day: number, outcome: InsightRunOutcome) {
  const slot = FIRST_SLOT + day * DAY;
  const woken = insightScheduleWake(state, context({ at: slot }));
  const after = insightRunSettled(
    woken.state,
    settled(`slot:${slot}`, slot, outcome),
    context({ at: slot + 60_000 }),
  );
  return { payload: woken.intents?.[0]?.payload, state: after.state };
}

const skippedFor = (days: number) =>
  Array.from({ length: days }, (_, day) => day).reduce(
    (state, day) => runDay(state, day, "skipped").state,
    turnedOn(),
  );

describe("given a schedule whose last 3 scheduled runs were skipped", () => {
  describe("when its slot comes due", () => {
    /** @scenario "A wake hands its run the skipped days before it" */
    it("hands the run 3 skipped days, and the count the state keeps is 3", () => {
      const state = skippedFor(3);

      const { payload } = runDay(state, 3, "skipped");

      expect(state.skipStreak).toEqual({ count: 3, slot: FIRST_SLOT + 2 * DAY });
      expect(payload).toMatchObject({ skippedDaysBefore: 3 });
    });

    it("hands a run that replaces one that never settled no skipped day", () => {
      const lostSlot = FIRST_SLOT + 3 * DAY;
      const lost = insightScheduleWake(skippedFor(3), context({ at: lostSlot })).state;
      const afterEveryLease = INSIGHT_DAILY_RUN_LEASE_MS * INSIGHT_DAILY_RUN_MAX_ATTEMPTS + DAY;

      const next = insightScheduleWake(lost, context({ at: lostSlot + afterEveryLease }));

      expect(next.intents?.[0]?.payload).toMatchObject({
        supersedes: { runId: `slot:${lostSlot}`, slot: lostSlot },
        skippedDaysBefore: 0,
      });
    });

    it("hands an operator's run no count at all", () => {
      const requested = insightRunRequested(
        skippedFor(3),
        { ...SCHEDULE, requestId: "request-1", maxInsights: 3 },
        context({ at: FIRST_SLOT + 3 * DAY - 60_000 }),
      );

      expect(requested.intents?.[0]?.payload).not.toHaveProperty("skippedDaysBefore");
    });
  });

  describe("when a run files, finds nothing or fails", () => {
    it.each(["filed", "nothing", "failed"] as const)("starts over after a run that %s", (how) => {
      const { state } = runDay(skippedFor(3), 3, how);

      expect(state.skipStreak.count).toBe(0);
      expect(runDay(state, 4, "skipped").payload).toMatchObject({ skippedDaysBefore: 0 });
    });
  });

  describe("when the person changes the setting", () => {
    it("starts the count over", () => {
      const changed = insightScheduleConfigured(
        skippedFor(3),
        { ...SETTINGS, hour: 10 },
        context({ at: FIRST_SLOT + 2 * DAY + 60_000 }),
      );

      expect(changed.state.skipStreak.count).toBe(0);
    });
  });
});

describe("given a schedule's process instance stored without a count", () => {
  describe("when it is read", () => {
    /** @scenario "A process instance written before the skipped days were counted still reads" */
    it("holds no skipped day, and no off reached it", () => {
      const { skipStreak: _skipStreak, turnedOff: _turnedOff, ...stored } = turnedOn();

      const state = insightDailyRunStateSchema.parse(stored);

      expect(state.skipStreak).toEqual({ count: 0, slot: null });
      expect(state.turnedOff).toBe(false);
      expect(runDay(state, 0, "skipped").state.skipStreak.count).toBe(1);
    });
  });
});

describe("given a process instance that never took a setting, and an off that reached it", () => {
  const off = insightScheduleTurnedOff(
    INITIAL_INSIGHT_DAILY_RUN_STATE,
    { ...SCHEDULE, by: "system", reason: "member_removed" },
    context({ at: EARLY }),
  );

  describe("when a reconcile pass's request to arm arrives, carrying the row's setting", () => {
    /** @scenario "A request to arm that arrives after an off arms nothing" */
    it("stays off, takes no setting and arms no wake", () => {
      const after = insightScheduleRearmRequested(
        off.state,
        SETTINGS,
        context({ at: EARLY + 60_000 }),
      );

      expect(off.state).toMatchObject({ active: false, schedule: null, turnedOff: true });
      expect(after).toEqual({ state: off.state, nextWakeAt: null, intents: [] });
    });
  });

  describe("when the person turns it on after that", () => {
    it("arms its slot, and a later request to arm is answered from its own setting", () => {
      const on = insightScheduleConfigured(off.state, SETTINGS, context({ at: EARLY + 60_000 }));

      expect(on.state).toMatchObject({ active: true, turnedOff: false });
      expect(on.nextWakeAt).toBe(FIRST_SLOT);
    });
  });
});
