/**
 * @vitest-environment node
 * The clean-up after a member left or a project was archived, over the memory worker: the
 * peer's fact is stored the way its own pipeline stores it, and the daily run pipeline's own
 * subscriber turns the schedules off.
 * @see modules/insight/specs/insight-daily-run-hardening.feature
 */

import {
  INSIGHT_DAILY_RUN_EVENT_TYPES,
  INSIGHT_DAILY_RUN_PIPELINE_NAME,
  type InsightRunBoard,
} from "@langwatch/insight-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BOARD,
  installDailyRuns,
  type InstalledDailyRuns,
  MEMBER,
  OTHER_MEMBER,
} from "./insight-daily-run.fixture.ts";
import { onFirstDay, scheduleDriver } from "./insight-daily-schedule.fixture.ts";
import { PROJECT } from "./insight.fixture.ts";

const { CONFIGURED, TURNED_OFF } = INSIGHT_DAILY_RUN_EVENT_TYPES;
const TEMPLATE: InsightRunBoard = { kind: "template", id: "llm-costs", name: "LLM costs" };
const LEFT_AT = onFirstDay("08:00");

let installed: InstalledDailyRuns;
let schedule: ReturnType<typeof scheduleDriver>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(onFirstDay("07:00"));
  installed = await installDailyRuns();
  schedule = scheduleDriver(installed);
});

afterEach(async () => {
  vi.useRealTimers();
  await installed.stop();
});

type Scope = { userId?: string; board?: InsightRunBoard };

const offOf = async (scope: Scope = {}) => {
  const { state, offReason } = await schedule.settingOf(scope);
  return { state, offReason };
};
const wakeOf = async (scope: Scope = {}) => (await installed.instanceOf(scope))?.nextWakeAt;
const turnedOffBySystem = (reason: string) => ({ state: "off", offReason: reason });

describe("given a member with daily runs on for two boards, and another member's on one", () => {
  beforeEach(async () => {
    await schedule.turnOn();
    await schedule.turnOn({ board: TEMPLATE });
    await schedule.turnOn({ userId: OTHER_MEMBER });
  });

  describe("when the member is removed from the organisation", () => {
    /** @scenario "A member removed from the organisation has their schedules turned off" */
    it("turns both of their schedules off with member_removed, and no other", async () => {
      await installed.memberRemoved({ userId: MEMBER, occurredAt: LEFT_AT, id: "fact-left" });

      await vi.waitFor(async () => {
        expect(await offOf({ board: TEMPLATE })).toEqual(turnedOffBySystem("member_removed"));
      });
      expect(await offOf()).toEqual(turnedOffBySystem("member_removed"));
      expect(await wakeOf()).toBeNull();
      expect(await wakeOf({ board: TEMPLATE })).toBeNull();
      expect(await offOf({ userId: OTHER_MEMBER })).toEqual({ state: "on", offReason: null });
      expect(await wakeOf({ userId: OTHER_MEMBER })).toBe(
        schedule.slotOf({ userId: OTHER_MEMBER }),
      );
      expect(await schedule.runDay({ day: 0 })).toBeUndefined();
    });
  });

  describe("when the same removal is handled twice", () => {
    /** @scenario "A clean-up fact delivered twice records one off" */
    it("records one off for each schedule", async () => {
      await installed.memberRemoved({ userId: MEMBER, occurredAt: LEFT_AT, id: "fact-left" });
      await vi.waitFor(async () => expect((await offOf()).state).toBe("off"));
      await installed.memberRemoved({ userId: MEMBER, occurredAt: LEFT_AT, id: "fact-left-again" });
      // The second fact is heard once the first schedule it could touch reads as it did.
      await vi.waitFor(() => expect(installed.listedOrganizations).toHaveLength(2));

      expect(await installed.runEventsOf()).toEqual([CONFIGURED, TURNED_OFF]);
      expect(await installed.runEventsOf({ board: TEMPLATE })).toEqual([CONFIGURED, TURNED_OFF]);
    });
  });

  describe("when the project is archived", () => {
    /** @scenario "An archived project has every schedule on its boards turned off" */
    it("turns every person's schedule off with project_archived", async () => {
      await installed.projectArchived({ occurredAt: LEFT_AT, id: "fact-archived" });

      await vi.waitFor(async () => {
        expect(await offOf({ userId: OTHER_MEMBER })).toEqual(
          turnedOffBySystem("project_archived"),
        );
      });
      expect(await offOf()).toEqual(turnedOffBySystem("project_archived"));
      expect(await offOf({ board: TEMPLATE })).toEqual(turnedOffBySystem("project_archived"));
      expect(await wakeOf()).toBeNull();
      expect(await wakeOf({ userId: OTHER_MEMBER })).toBeNull();
    });
  });
});

describe("given a member who turned their daily run off", () => {
  beforeEach(async () => {
    await schedule.turnOn();
    await installed.app.turnOffDailyRun({ projectId: PROJECT, userId: MEMBER, board: BOARD });
  });

  describe("when the member is removed from the organisation", () => {
    /** @scenario "A schedule its person turned off keeps no reason after a clean-up" */
    it("records nothing more and still reads off with no reason", async () => {
      await installed.memberRemoved({ userId: MEMBER, occurredAt: LEFT_AT, id: "fact-left" });
      await vi.waitFor(() => expect(installed.listedOrganizations).toHaveLength(1));

      expect(await installed.runEventsOf()).toEqual([CONFIGURED, TURNED_OFF]);
      expect(await offOf()).toEqual({ state: "off", offReason: null });
    });
  });
});

describe("given a schedule a clean-up turned off", () => {
  beforeEach(async () => {
    await schedule.turnOn();
    await installed.projectArchived({ occurredAt: LEFT_AT, id: "fact-archived" });
    await vi.waitFor(async () => {
      if ((await offOf()).state !== "off") throw new Error("still on");
    });
  });

  describe("when a reconcile pass runs", () => {
    /** @scenario "A schedule a clean-up turned off is not armed again by the reconcile pass" */
    it("asks nothing of the schedule and arms no wake", async () => {
      await installed.reconcile({ passAt: onFirstDay("08:30") });

      expect(await installed.runEventsOf()).toEqual([CONFIGURED, TURNED_OFF]);
      expect(await wakeOf()).toBeNull();
      expect(await offOf()).toEqual(turnedOffBySystem("project_archived"));
      expect(await schedule.runDay({ day: 0 })).toBeUndefined();
    });
  });
});

describe("given the daily run pipeline as the worker registers it", () => {
  /** @scenario "The daily run pipeline hears who left and what was archived" */
  it("subscribes to the member removed fact and to the project archived fact", () => {
    const lanes = installed.eventing.definitions
      .find(({ metadata }) => metadata.name === INSIGHT_DAILY_RUN_PIPELINE_NAME)
      ?.open((definition) => definition.globalProjections?.map(({ name }) => name));

    expect(lanes).toEqual([
      `${INSIGHT_DAILY_RUN_PIPELINE_NAME}.memberRemoved`,
      `${INSIGHT_DAILY_RUN_PIPELINE_NAME}.projectArchived`,
    ]);
  });
});
