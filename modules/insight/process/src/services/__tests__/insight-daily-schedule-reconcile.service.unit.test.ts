/**
 * @vitest-environment node
 * The reconcile pass over the memory rows and the memory process store: which schedules it asks
 * to arm themselves, and which it leaves alone.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import { createTenantId, InMemoryProcessStore } from "@langwatch/eventing";
import type { InsightScheduleConfiguredEventData } from "@langwatch/insight-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { beforeEach, describe, expect, it } from "vitest";

import {
  INITIAL_INSIGHT_DAILY_RUN_STATE,
  INSIGHT_DAILY_RUN_PROCESS_NAME,
  type InsightDailyRunState,
} from "../../eventing/insight-daily-run.process.ts";
import type { InsightDailyScheduleState } from "../../eventing/insight-daily-schedule.projection.ts";
import type { InsightRepositories } from "../../repositories/insight.repositories.ts";
import { MemoryInsightRepositories } from "../../repositories/memory/memory.insight.repositories.ts";
import { dailyScheduleId } from "../../rules/insight-daily-run.rules.ts";
import type { InsightDailyRunCommandsService } from "../insight-daily-run-commands.service.ts";
import { InsightDailyScheduleReconcileService } from "../insight-daily-schedule-reconcile.service.ts";

const PASS_AT = Date.UTC(2026, 9, 10, 8);
const SETTINGS = { hour: 9, timezone: "UTC", maxInsights: 3 } as const;
const SCHEDULE = {
  userId: "user-1",
  board: { kind: "dashboard", id: "dashboard-1", name: "Costs" },
  ...SETTINGS,
} as const;

type Rearm = InsightScheduleConfiguredEventData & { tenantId: string; occurredAt: number };

let repositories: InsightRepositories;
let instances: InMemoryProcessStore;
let rearms: Rearm[];
let service: InsightDailyScheduleReconcileService;

beforeEach(() => {
  repositories = MemoryInsightRepositories.create();
  instances = InMemoryProcessStore.createForTesting();
  rearms = [];
  service = InsightDailyScheduleReconcileService.create({
    schedules: repositories.dailySchedules,
    commands: createApiFixture<Pick<InsightDailyRunCommandsService, "requestScheduleRearm">>({
      requestScheduleRearm: async (input) => void rearms.push(input),
    }),
  });
  service.connect(instances);
});

/** Folds a schedule's row the way its events would, and answers its id. */
async function row({
  projectId = "project-1",
  boardId = "dashboard-1",
  state = "on",
}: {
  projectId?: string;
  boardId?: string;
  state?: InsightDailyScheduleState["state"];
} = {}): Promise<string> {
  const board = { kind: "dashboard", id: boardId } as const;
  const scheduleId = dailyScheduleId({ projectId, userId: SCHEDULE.userId, board });
  await repositories.dailyScheduleProjection.store(
    {
      state: {
        userId: SCHEDULE.userId,
        boardKind: board.kind,
        boardId,
        boardName: "Costs",
        state,
        ...SETTINGS,
        lastRunId: null,
        lastRunAt: null,
        lastRunOutcome: null,
        lastRunReason: null,
        lastRunFiled: null,
        lastRunConversationId: null,
      },
      cursor: { acceptedAt: PASS_AT, eventId: `event-${scheduleId}` },
      occurredAt: PASS_AT,
      createdAt: PASS_AT,
      updatedAt: PASS_AT,
      version: "2026-10-10",
    },
    { tenantId: createTenantId(projectId), aggregateId: scheduleId, key: scheduleId },
  );
  return scheduleId;
}

/** Commits the schedule's process instance as its handlers would have left it. */
async function instance({
  scheduleId,
  projectId = "project-1",
  state,
  nextWakeAt,
}: {
  scheduleId: string;
  projectId?: string;
  state: InsightDailyRunState;
  nextWakeAt: number | null;
}): Promise<void> {
  await instances.commit({
    ref: { processName: INSIGHT_DAILY_RUN_PROCESS_NAME, projectId, processKey: scheduleId },
    tenantId: projectId,
    sourceEventId: `event-${scheduleId}`,
    expectedRevision: 0,
    state,
    nextWakeAt,
    messages: [],
    now: PASS_AT,
  });
}

const ON: InsightDailyRunState = {
  ...INITIAL_INSIGHT_DAILY_RUN_STATE,
  schedule: SCHEDULE,
  active: true,
};

describe("given schedules that are on", () => {
  describe("when one has no process instance", () => {
    /** @scenario "A schedule that is on with no process instance is armed by the pass" */
    it("asks its process to arm itself, with the row's own setting and the pass's instant", async () => {
      const scheduleId = await row();

      const outcome = await service.reconcile({ passAt: PASS_AT });

      expect(outcome).toEqual({ repaired: 1 });
      expect(rearms).toEqual([
        { tenantId: "project-1", occurredAt: PASS_AT, scheduleId, ...SCHEDULE },
      ]);
    });
  });

  describe("when one's instance is on with no wake armed", () => {
    /** @scenario "A schedule whose wake was lost is armed again with its own setting" */
    it("asks its process to arm itself", async () => {
      const scheduleId = await row();
      await instance({ scheduleId, state: ON, nextWakeAt: null });

      expect(await service.reconcile({ passAt: PASS_AT })).toEqual({ repaired: 1 });
      expect(rearms.map((rearm) => rearm.scheduleId)).toEqual([scheduleId]);
    });

    it("asks an instance only an operator's request ever reached", async () => {
      const scheduleId = await row();
      await instance({ scheduleId, state: INITIAL_INSIGHT_DAILY_RUN_STATE, nextWakeAt: null });

      expect(await service.reconcile({ passAt: PASS_AT })).toEqual({ repaired: 1 });
    });
  });

  describe("when one's wake is armed", () => {
    /** @scenario "A pass leaves an armed schedule alone" */
    it("asks nothing of it", async () => {
      const scheduleId = await row();
      await instance({ scheduleId, state: ON, nextWakeAt: PASS_AT + 3_600_000 });

      expect(await service.reconcile({ passAt: PASS_AT })).toEqual({ repaired: 0 });
      expect(rearms).toEqual([]);
    });
  });

  describe("when the person turned one off and its row is a fold behind", () => {
    /** @scenario "A pass turns on no schedule the person turned off" */
    it("asks nothing of it", async () => {
      const scheduleId = await row();
      await instance({ scheduleId, state: { ...ON, active: false }, nextWakeAt: null });

      expect(await service.reconcile({ passAt: PASS_AT })).toEqual({ repaired: 0 });
      expect(rearms).toEqual([]);
    });
  });

  describe("when they are in several projects, beside rows that are off or undecided", () => {
    /** @scenario "A reconcile pass reads every project's schedules that are on" */
    it("asks each schedule that is on, in its own project, and no other", async () => {
      const here = await row();
      const there = await row({ projectId: "project-2" });
      await row({ boardId: "dashboard-off", state: "off" });
      await row({ boardId: "dashboard-undecided", state: "undecided" });

      expect(await service.reconcile({ passAt: PASS_AT })).toEqual({ repaired: 2 });
      expect(
        rearms
          .map((rearm) => [rearm.tenantId, rearm.scheduleId])
          .toSorted(([a = ""], [b = ""]) => a.localeCompare(b)),
      ).toEqual([
        ["project-1", here],
        ["project-2", there],
      ]);
    });
  });

  describe("when the same pass is carried out twice", () => {
    /** @scenario "A pass carried out twice asks each schedule once" */
    it("names the same pass both times, so the second request is the first again", async () => {
      await row();

      await service.reconcile({ passAt: PASS_AT });
      await service.reconcile({ passAt: PASS_AT });

      expect(rearms).toHaveLength(2);
      expect(rearms[1]).toEqual(rearms[0]);
    });
  });
});
