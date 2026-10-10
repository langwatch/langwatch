/**
 * @vitest-environment node
 * The schedule's side of the daily run process, at fixed instants: what turning it on, changing
 * it and turning it off arm, and what a wake starts. Pure handlers, no store.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import { buildIntentAccessor } from "@langwatch/eventing";
import type {
  InsightRunSettledEventData,
  InsightScheduleConfiguredEventData,
} from "@langwatch/insight-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { dailyScheduleId } from "../../rules/insight-daily-run.rules.ts";
import { dailyScheduleMinute } from "../../rules/insight-daily-schedule.rules.ts";
import {
  INSIGHT_DAILY_RUN_LEASE_MS,
  INSIGHT_DAILY_RUN_MAX_ATTEMPTS,
  runBoardIntentSchema,
} from "../insight-daily-run.intent.ts";
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
const MM = String(dailyScheduleMinute({ scheduleId: SCHEDULE.scheduleId })).padStart(2, "0");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const at = (iso: string) => Temporal.Instant.from(iso).epochMilliseconds;
/** The schedule's slot on a date at an hour, in UTC: its hour and its own minute. */
const slotOn = (date: string, hour: number) =>
  at(`${date}T${String(hour).padStart(2, "0")}:${MM}:00Z`);

const TODAY = "2026-10-10";
const TOMORROW = "2026-10-11";
const EARLY = at(`${TODAY}T07:00:00Z`);

function context({
  at: instant,
  now = instant,
  key = SCHEDULE.scheduleId,
}: {
  at: number;
  now?: number;
  key?: string;
}) {
  return {
    at: instant,
    now,
    key,
    projectId: OWNER.projectId,
    intent: buildIntentAccessor({
      runBoard: { schema: runBoardIntentSchema, run: async () => {} },
    }),
  };
}

const settings = (
  overrides: Partial<InsightScheduleConfiguredEventData> = {},
): InsightScheduleConfiguredEventData => ({
  ...SCHEDULE,
  hour: 9,
  timezone: "UTC",
  maxInsights: 3,
  ...overrides,
});

const settled = (runId: string): InsightRunSettledEventData => ({
  ...SCHEDULE,
  runId,
  slot: 0,
  outcome: "filed",
  reason: null,
  filedCount: 1,
  conversationId: "conversation-1",
});

/** The schedule turned on at `now` for an hour, from nothing. */
function turnedOn({ hour = 9, now = EARLY }: { hour?: number; now?: number } = {}) {
  return insightScheduleConfigured(
    INITIAL_INSIGHT_DAILY_RUN_STATE,
    settings({ hour }),
    context({ at: now }),
  );
}

/** The state after today's 09:mm wake ran and its run settled. */
function ranToday(): InsightDailyRunState {
  const slot = slotOn(TODAY, 9);
  const woken = insightScheduleWake(turnedOn().state, context({ at: slot }));
  return insightRunSettled(woken.state, settled(`slot:${slot}`), context({ at: slot + MINUTE }))
    .state;
}

describe("given a person turns their daily run on", () => {
  /** @scenario "Turning the daily run on arms the next slot and starts no run" */
  it("arms today's slot when its hour is still ahead, and starts nothing", () => {
    const evolution = turnedOn({ hour: 9, now: EARLY });

    expect(evolution.nextWakeAt).toBe(slotOn(TODAY, 9));
    expect(evolution.intents).toEqual([]);
    expect(evolution.state).toMatchObject({
      active: true,
      schedule: { userId: "user-1", board: BOARD, hour: 9, timezone: "UTC", maxInsights: 3 },
      pendingRun: null,
      lastSlot: null,
    });
  });

  it("arms tomorrow's slot when today's has passed, and starts nothing", () => {
    const evolution = turnedOn({ hour: 9, now: slotOn(TODAY, 9) + 1 });

    expect(evolution.nextWakeAt).toBe(slotOn(TOMORROW, 9));
    expect(evolution.intents).toEqual([]);
  });

  it("reads the hour in the schedule's own zone, clock changes included", () => {
    const evolution = insightScheduleConfigured(
      INITIAL_INSIGHT_DAILY_RUN_STATE,
      settings({ hour: 2, timezone: "Europe/Amsterdam" }),
      context({ at: at("2026-03-28T12:00:00Z") }),
    );

    // 02:mm does not exist in Amsterdam on 2026-03-29: the slot is 03:mm there, 01:mm UTC.
    expect(evolution.nextWakeAt).toBe(at(`2026-03-29T01:${MM}:00Z`));
  });
});

describe("given a schedule that is on and its slot is due", () => {
  const slot = slotOn(TODAY, 9);

  /** @scenario "A wake starts one run for its slot, on the path a request takes" */
  it("hands the outbox one runBoard intent for the person, the board and the slot", () => {
    const requested = insightRunRequested(
      INITIAL_INSIGHT_DAILY_RUN_STATE,
      { ...SCHEDULE, requestId: "run-1", maxInsights: 3 },
      context({ at: slot }),
    );
    const woken = insightScheduleWake(turnedOn().state, context({ at: slot, now: slot + 2_000 }));

    expect(woken.intents).toEqual([
      {
        intentType: "runBoard",
        messageKey: `run:slot:${slot}`,
        payload: { ...SCHEDULE, maxInsights: 3, runId: `slot:${slot}`, slot },
      },
    ]);
    // The same intent a request writes, but for the run's name.
    expect(woken.intents?.[0]).toMatchObject({
      intentType: requested.intents?.[0]?.intentType,
      payload: { ...SCHEDULE, maxInsights: 3, slot },
    });
    expect(woken.state.pendingRun).toEqual({ runId: `slot:${slot}`, since: slot + 2_000, slot });
    expect(woken.state.lastSlot).toBe(slot);
    expect(woken.nextWakeAt).toBe(slotOn(TOMORROW, 9));
  });

  /** @scenario "A second wake for the same calendar date starts no second run" */
  it("starts nothing for a second wake on the same date, and arms the next day", () => {
    const first = insightScheduleWake(turnedOn().state, context({ at: slot }));

    const again = insightScheduleWake(first.state, context({ at: slot, now: slot + 5_000 }));
    const laterThatDay = insightScheduleWake(first.state, context({ at: slot + 3 * HOUR }));

    expect(again.intents).toEqual([]);
    expect(again.nextWakeAt).toBe(slotOn(TOMORROW, 9));
    expect(laterThatDay.intents).toEqual([]);
    expect(laterThatDay.state).toBe(first.state);
  });

  describe("when the fleet was down as the slot came due", () => {
    /** @scenario "A slot missed by less than six hours still runs" */
    it("runs the slot once when the wake is 5 hours 59 minutes late", () => {
      const late = slot + 5 * HOUR + 59 * MINUTE;

      const woken = insightScheduleWake(turnedOn().state, context({ at: slot, now: late }));

      expect(woken.intents).toHaveLength(1);
      expect(woken.intents?.[0]?.payload).toMatchObject({ runId: `slot:${slot}`, slot });
      expect(woken.state.lastSlot).toBe(slot);
      expect(woken.nextWakeAt).toBe(slotOn(TOMORROW, 9));
    });

    /** @scenario "A slot missed by six hours or more waits for the next day" */
    it("starts nothing when the wake is 6 hours 1 minute late, and arms the next day", () => {
      const late = slot + 6 * HOUR + MINUTE;

      const woken = insightScheduleWake(turnedOn().state, context({ at: slot, now: late }));

      expect(woken.intents).toEqual([]);
      expect(woken.state.lastSlot).toBeNull();
      expect(woken.state.pendingRun).toBeNull();
      expect(woken.nextWakeAt).toBe(slotOn(TOMORROW, 9));
    });
  });

  describe("when a run for the board is still in flight", () => {
    /** @scenario "A wake while a run is in flight starts no second run" */
    it("starts no second run, counts the slot as taken and arms the next day", () => {
      const requested = insightRunRequested(
        turnedOn().state,
        { ...SCHEDULE, requestId: "run-1", maxInsights: 3 },
        context({ at: slot - 10 * MINUTE }),
      );

      const woken = insightScheduleWake(requested.state, context({ at: slot }));

      expect(requested.nextWakeAt).toBe(slot);
      expect(woken.intents).toEqual([]);
      expect(woken.state.pendingRun).toEqual(requested.state.pendingRun);
      expect(woken.state.lastSlot).toBe(slot);
      expect(woken.nextWakeAt).toBe(slotOn(TOMORROW, 9));
    });
  });
});

describe("given a scheduled run that never recorded an outcome", () => {
  /** @scenario "A run that never settled is superseded by the next day's wake" */
  it("starts the next day's run and hands it the lost run to record", () => {
    const first = slotOn(TODAY, 9);
    const second = slotOn(TOMORROW, 9);
    const unsettled = insightScheduleWake(turnedOn().state, context({ at: first }));

    const next = insightScheduleWake(unsettled.state, context({ at: second }));

    expect(second - first).toBeGreaterThan(
      INSIGHT_DAILY_RUN_LEASE_MS * INSIGHT_DAILY_RUN_MAX_ATTEMPTS,
    );
    expect(next.intents).toHaveLength(1);
    expect(next.intents?.[0]?.payload).toMatchObject({
      runId: `slot:${second}`,
      slot: second,
      supersedes: { runId: `slot:${first}`, slot: first },
    });
    expect(next.state.pendingRun).toEqual({ runId: `slot:${second}`, since: second, slot: second });
  });

  it("names no lost run once the run before settled", () => {
    const next = insightScheduleWake(ranToday(), context({ at: slotOn(TOMORROW, 9) }));

    expect(next.intents?.[0]?.payload).not.toHaveProperty("supersedes");
  });
});

describe("given a person changes the hour during the day", () => {
  /** @scenario "An hour changed before today's run runs today at the new hour" */
  it("arms today at the new hour when it is ahead and no run happened today", () => {
    const changed = insightScheduleConfigured(
      turnedOn({ hour: 9 }).state,
      settings({ hour: 11 }),
      context({ at: at(`${TODAY}T08:00:00Z`) }),
    );

    expect(changed.nextWakeAt).toBe(slotOn(TODAY, 11));
    expect(changed.intents).toEqual([]);
  });

  /** @scenario "An hour changed after today's run waits for the next day" */
  it("arms tomorrow at the new hour when today's run already happened", () => {
    const changed = insightScheduleConfigured(
      ranToday(),
      settings({ hour: 15 }),
      context({ at: at(`${TODAY}T10:00:00Z`) }),
    );

    expect(changed.nextWakeAt).toBe(slotOn(TOMORROW, 15));
    expect(changed.intents).toEqual([]);
  });

  /** @scenario "An hour changed to one that has passed starts no run and waits for the next day" */
  it("arms tomorrow and starts nothing when the new hour has passed", () => {
    const changed = insightScheduleConfigured(
      turnedOn({ hour: 9 }).state,
      settings({ hour: 7 }),
      context({ at: at(`${TODAY}T08:00:00Z`) }),
    );

    expect(changed.nextWakeAt).toBe(slotOn(TOMORROW, 7));
    expect(changed.intents).toEqual([]);
  });

  it("keeps the new maximum for the next run", () => {
    const changed = insightScheduleConfigured(
      turnedOn().state,
      settings({ maxInsights: 10 }),
      context({ at: at(`${TODAY}T08:00:00Z`) }),
    );

    const woken = insightScheduleWake(changed.state, context({ at: slotOn(TODAY, 9) }));

    expect(woken.intents?.[0]?.payload).toMatchObject({ maxInsights: 10 });
  });
});

describe("given a person turns their daily run off", () => {
  const off = (state: InsightDailyRunState, instant: number) =>
    insightScheduleTurnedOff(
      state,
      { ...SCHEDULE, by: "person", reason: null },
      context({ at: instant }),
    );

  /** @scenario "Turning the daily run off cancels its wake" */
  it("disarms the wake, and a stray wake starts nothing", () => {
    const turnedOff = off(turnedOn().state, at(`${TODAY}T08:00:00Z`));

    const stray = insightScheduleWake(turnedOff.state, context({ at: slotOn(TODAY, 9) }));

    expect(turnedOff.nextWakeAt).toBeNull();
    expect(turnedOff.state).toMatchObject({ active: false, schedule: { hour: 9 } });
    expect(stray).toEqual({ state: turnedOff.state, nextWakeAt: null, intents: [] });
  });

  /** @scenario "A daily run turned off and on again the same day does not run twice" */
  it("arms tomorrow when it is turned on again after today's run", () => {
    const turnedOff = off(ranToday(), at(`${TODAY}T10:00:00Z`));

    const onAgain = insightScheduleConfigured(
      turnedOff.state,
      settings({ hour: 15 }),
      context({ at: at(`${TODAY}T11:00:00Z`) }),
    );

    expect(onAgain.nextWakeAt).toBe(slotOn(TOMORROW, 15));
    expect(onAgain.intents).toEqual([]);
  });

  it("stays off when a run of it settles later", () => {
    const slot = slotOn(TODAY, 9);
    const woken = insightScheduleWake(turnedOn().state, context({ at: slot }));
    const turnedOff = off(woken.state, slot + MINUTE);

    const after = insightRunSettled(
      turnedOff.state,
      settled(`slot:${slot}`),
      context({ at: slot + 2 * MINUTE }),
    );

    expect(after.nextWakeAt).toBeNull();
    expect(after.state.pendingRun).toBeNull();
  });
});

describe("given a schedule that is on", () => {
  /** @scenario "An operator's run leaves the schedule's wake armed" */
  it("keeps the wake armed through a request and its outcome", () => {
    const requested = insightRunRequested(
      turnedOn().state,
      { ...SCHEDULE, requestId: "run-1", maxInsights: 3 },
      context({ at: at(`${TODAY}T07:30:00Z`) }),
    );
    const afterSettle = insightRunSettled(
      requested.state,
      settled("run-1"),
      context({ at: at(`${TODAY}T07:40:00Z`) }),
    );

    expect(requested.intents).toHaveLength(1);
    expect(requested.nextWakeAt).toBe(slotOn(TODAY, 9));
    expect(afterSettle.nextWakeAt).toBe(slotOn(TODAY, 9));
    // An operator's run is no scheduled run: today's slot still runs.
    expect(afterSettle.state.lastSlot).toBeNull();
  });
});

describe("given a reconcile pass asks a schedule to arm itself", () => {
  const passAt = at(`${TODAY}T08:00:00Z`);

  /** @scenario "A schedule that is on with no process instance is armed by the pass" */
  it("takes the row's setting and arms the next slot on an instance that never had it", () => {
    const armed = insightScheduleRearmRequested(
      INITIAL_INSIGHT_DAILY_RUN_STATE,
      settings({ hour: 9 }),
      context({ at: passAt }),
    );

    expect(armed.state).toMatchObject({ active: true, schedule: { hour: 9, timezone: "UTC" } });
    expect(armed.nextWakeAt).toBe(slotOn(TODAY, 9));
    expect(armed.intents).toEqual([]);
  });

  /** @scenario "A schedule whose wake was lost is armed again with its own setting" */
  it("arms from the instance's own setting, not the row's, and not on a date that ran", () => {
    const armed = insightScheduleRearmRequested(
      ranToday(),
      settings({ hour: 23, maxInsights: 10 }),
      context({ at: at(`${TODAY}T10:00:00Z`) }),
    );

    expect(armed.state.schedule).toMatchObject({ hour: 9, maxInsights: 3 });
    expect(armed.nextWakeAt).toBe(slotOn(TOMORROW, 9));
    expect(armed.intents).toEqual([]);
  });

  /** @scenario "A pass turns on no schedule the person turned off" */
  it("leaves a schedule the person turned off since off", () => {
    const turnedOff = insightScheduleTurnedOff(
      turnedOn().state,
      { ...SCHEDULE, by: "person", reason: null },
      context({ at: EARLY + MINUTE }),
    );

    const after = insightScheduleRearmRequested(
      turnedOff.state,
      settings(),
      context({ at: passAt }),
    );

    expect(after).toEqual({ state: turnedOff.state, nextWakeAt: null, intents: [] });
  });
});

describe("given a schedule event that names a schedule other than its own", () => {
  const otherPerson = dailyScheduleId({ ...OWNER, userId: "user-2" });

  /** @scenario "A setting whose schedule is not its person's and board's changes nothing" */
  it.each([
    ["another person's schedule", { scheduleId: otherPerson }, {}],
    ["another person on its own schedule", { userId: "user-2" }, {}],
    ["its own schedule on another's stream", {}, { key: otherPerson }],
  ])("turns nothing on for a setting with %s", (_what, data, where) => {
    const evolution = insightScheduleConfigured(
      INITIAL_INSIGHT_DAILY_RUN_STATE,
      { ...settings(), ...data },
      context({ at: EARLY, ...where }),
    );

    expect(evolution).toEqual({
      state: INITIAL_INSIGHT_DAILY_RUN_STATE,
      nextWakeAt: null,
      intents: [],
    });
  });

  it("turns nothing off, and keeps the wake armed", () => {
    const on = turnedOn();

    const after = insightScheduleTurnedOff(
      on.state,
      { ...SCHEDULE, scheduleId: otherPerson, by: "person", reason: null },
      context({ at: EARLY + MINUTE }),
    );

    expect(after.state).toBe(on.state);
    expect(after.nextWakeAt).toBe(slotOn(TODAY, 9));
  });
});

describe("given a process instance written before a schedule could be turned on", () => {
  /** @scenario "A process instance written before the schedule still reads" */
  it("reads as a schedule nobody turned on, with its run in flight kept", () => {
    const stored = { lastRequestId: "run-1", pendingRun: { runId: "run-1", since: EARLY } };

    const state = insightDailyRunStateSchema.parse(stored);
    const woken = insightScheduleWake(state, context({ at: slotOn(TODAY, 9) }));

    expect(state).toEqual({ ...INITIAL_INSIGHT_DAILY_RUN_STATE, ...stored });
    expect(woken).toEqual({ state, nextWakeAt: null, intents: [] });
  });

  it("names the lost run's start as its slot when it kept none", () => {
    const stored = { lastRequestId: "run-1", pendingRun: { runId: "run-1", since: EARLY } };
    const on = insightScheduleConfigured(
      insightDailyRunStateSchema.parse(stored),
      settings(),
      context({ at: EARLY + MINUTE }),
    );

    const next = insightScheduleWake(on.state, context({ at: slotOn(TOMORROW, 9) }));

    expect(next.intents?.[0]?.payload).toMatchObject({
      supersedes: { runId: "run-1", slot: EARLY },
    });
  });
});
