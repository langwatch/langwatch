/**
 * @vitest-environment node
 * Run now over the memory rows: what it answers and whether it requests a run.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import type { DashboardApi } from "@langwatch/dashboard-contract";
import { createTenantId } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import type { InsightDailyScheduleState } from "../../eventing/insight-daily-schedule.projection.ts";
import type { InsightRepositories } from "../../repositories/insight.repositories.ts";
import { MemoryInsightRepositories } from "../../repositories/memory/memory.insight.repositories.ts";
import { dailyScheduleId } from "../../rules/insight-daily-run.rules.ts";
import type { InsightDailyRunCommandsService } from "../insight-daily-run-commands.service.ts";
import { InsightDailyScheduleService } from "../insight-daily-schedule.service.ts";

const PROJECT = "project-1";
const USER = "user-1";
const BOARD = { kind: "dashboard", id: "dashboard-1", name: "Costs" } as const;
const RUN_NOW = { projectId: PROJECT, userId: USER, board: BOARD, maxInsights: 3 } as const;

let repositories: InsightRepositories;
let requested: string[];
let requestedAtTimes: number[];
let service: InsightDailyScheduleService;

beforeEach(() => {
  repositories = MemoryInsightRepositories.create();
  requested = [];
  requestedAtTimes = [];
  service = InsightDailyScheduleService.create({
    schedules: repositories.dailySchedules,
    commands: createApiFixture<InsightDailyRunCommandsService>({
      requestRun: async ({ requestId, occurredAt }) => {
        requested.push(requestId);
        requestedAtTimes.push(occurredAt);
      },
    }),
    dashboards: createApiFixture<Pick<DashboardApi, "getById">>({}),
  });
});

/** Folds the member's row on the board as its events would: on, with a run in flight. */
async function onWithRunInFlight({ startedAt }: { startedAt: number }): Promise<void> {
  const now = nowInstant().epochMilliseconds;
  const scheduleId = dailyScheduleId({ projectId: PROJECT, userId: USER, board: BOARD });
  const state: InsightDailyScheduleState = {
    userId: USER,
    boardKind: BOARD.kind,
    boardId: BOARD.id,
    boardName: BOARD.name,
    state: "on",
    offReason: null,
    hour: 9,
    timezone: "UTC",
    maxInsights: 3,
    consecutiveSkips: 0,
    skipStreakSlot: null,
    runInFlightId: "slot:1",
    runInFlightConversationId: "conversation-1",
    runInFlightStartedAt: startedAt,
    lastRunId: null,
    lastRunAt: null,
    lastRunOutcome: null,
    lastRunReason: null,
    lastRunFiled: null,
    lastRunRenewed: null,
    lastRunConversationId: null,
  };
  await repositories.dailyScheduleProjection.store(
    {
      state,
      cursor: { acceptedAt: now, eventId: "event-1" },
      occurredAt: now,
      createdAt: now,
      updatedAt: now,
      version: "2026-10-10",
    },
    { tenantId: createTenantId(PROJECT), aggregateId: scheduleId, key: scheduleId },
  );
}

describe("given a member's board that is on, with a run in flight", () => {
  beforeEach(async () => {
    await onWithRunInFlight({ startedAt: nowInstant().epochMilliseconds });
  });

  describe("when they choose Run now", () => {
    /** @scenario "Run now on a board whose run is already going follows that run" */
    it("answers the id of the run in flight, and requests no run", async () => {
      expect(await service.runNow(RUN_NOW)).toEqual({
        requestId: "slot:1",
        requestedAt: expect.any(Number),
      });
      expect(requested).toEqual([]);
    });
  });
});

describe("given a member's board that is on, whose run in flight is lost", () => {
  beforeEach(async () => {
    await onWithRunInFlight({ startedAt: 0 });
  });

  describe("when they choose Run now", () => {
    it("requests a run, and answers its request's id and the time it was recorded at", async () => {
      const { requestId, requestedAt } = await service.runNow(RUN_NOW);

      expect(requested).toEqual([requestId]);
      expect(requestedAtTimes).toEqual([requestedAt]);
      expect(requestId).not.toBe("slot:1");
    });
  });
});
