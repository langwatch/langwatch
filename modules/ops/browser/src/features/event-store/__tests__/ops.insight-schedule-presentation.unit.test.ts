import type { OpsInsightSchedule } from "@langwatch/ops-contract";
import { describe, expect, it } from "vitest";

import {
  compareInsightSchedules,
  insightScheduleStatus,
  lastRunWords,
  offReasonWords,
  runTimeWords,
  skippedDaysWords,
} from "../model/insight-schedule-presentation.ts";

const schedule = (over: Partial<OpsInsightSchedule> = {}): OpsInsightSchedule => ({
  id: "schedule-1",
  projectId: "project-1",
  projectName: "Acme",
  userId: "user-1",
  owner: "Ada",
  boardKind: "dashboard",
  boardId: "board-1",
  boardName: "Weekly quality",
  on: true,
  offReason: null,
  hour: 9,
  timezone: "Europe/Amsterdam",
  nextRunAt: "2026-10-12T07:12:00.000Z",
  lastRunAt: "2026-10-11T07:12:00.000Z",
  lastRunOutcome: "filed",
  lastRunReason: null,
  consecutiveSkips: 0,
  skippedDaysBeforeOff: 7,
  ...over,
});

describe("insightScheduleStatus", () => {
  it("reads a schedule that is on with a wake as on", () => {
    expect(insightScheduleStatus(schedule())).toBe("on");
  });

  it("reads a schedule that is on with no wake as not armed", () => {
    expect(insightScheduleStatus(schedule({ nextRunAt: null }))).toBe("not_armed");
  });

  it("reads a schedule that is on with skipped days as skipping", () => {
    expect(insightScheduleStatus(schedule({ consecutiveSkips: 3 }))).toBe("skipping");
  });

  it("tells an off the system did from one its person did", () => {
    const off = { on: false, nextRunAt: null };

    expect(insightScheduleStatus(schedule({ ...off, offReason: "skipped_days" }))).toBe(
      "turned_off",
    );
    expect(insightScheduleStatus(schedule(off))).toBe("off");
  });
});

describe("compareInsightSchedules", () => {
  /** @scenario "The schedules that need a look come first" */
  it("puts no wake first, then the nearest to turning off, then on, then off", () => {
    const rows = [
      schedule({ id: "off", on: false, nextRunAt: null }),
      schedule({ id: "on" }),
      schedule({ id: "turned-off", on: false, nextRunAt: null, offReason: "member_removed" }),
      schedule({ id: "skipped-2", consecutiveSkips: 2 }),
      schedule({ id: "skipped-6", consecutiveSkips: 6 }),
      schedule({ id: "not-armed", nextRunAt: null }),
    ];

    expect(rows.toSorted(compareInsightSchedules).map((row) => row.id)).toEqual([
      "not-armed",
      "skipped-6",
      "skipped-2",
      "on",
      "turned-off",
      "off",
    ]);
  });
});

describe("the words of a row", () => {
  it("says each reason the system turns a schedule off for", () => {
    expect(offReasonWords({ offReason: "skipped_days" })).toBe("skipped too many days in a row");
    expect(offReasonWords({ offReason: "member_removed" })).toBe(
      "the member left the organisation",
    );
    expect(offReasonWords({ offReason: "project_archived" })).toBe("the project was archived");
    expect(offReasonWords({ offReason: "board_deleted" })).toBe("the board is gone");
  });

  it("shows a reason it does not know as it is, and none as nothing", () => {
    expect(offReasonWords({ offReason: "something_new" })).toBe("something_new");
    expect(offReasonWords({ offReason: null })).toBe("");
  });

  it("says the hour and zone, or that none was ever set", () => {
    expect(runTimeWords({ hour: 9, timezone: "Europe/Amsterdam" })).toBe(
      "around 09:00 Europe/Amsterdam",
    );
    expect(runTimeWords({ hour: null, timezone: null })).toBe("never set");
  });

  it("says how the last run ended and why", () => {
    expect(lastRunWords({ lastRunOutcome: "skipped", lastRunReason: "no_access" })).toBe(
      "skipped · no_access",
    );
    expect(lastRunWords({ lastRunOutcome: "filed", lastRunReason: null })).toBe("filed");
    expect(lastRunWords({ lastRunOutcome: null, lastRunReason: null })).toBe("no run yet");
  });

  it("says the skipped days out of how many turn the schedule off", () => {
    expect(skippedDaysWords({ consecutiveSkips: 2, skippedDaysBeforeOff: 7 })).toBe("2 of 7");
  });
});
