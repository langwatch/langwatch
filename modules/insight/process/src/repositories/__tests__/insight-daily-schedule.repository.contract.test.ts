/**
 * @vitest-environment node
 * Whose run rows a read answers, stated once and run against both backends: the memory twin
 * always, and Postgres when a test database is named at `LANGWATCH_TEST_DATABASE_URL`.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import { randomUUID } from "node:crypto";

import { createTenantId, type StoredProjection } from "@langwatch/eventing";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createTestLogger } from "@langwatch/test-harness";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { InsightDailyScheduleState } from "../../eventing/insight-daily-schedule.projection.ts";
import {
  type InsightRunInFlightState,
  NO_RUN_STARTED,
} from "../../eventing/insight-run-in-flight.projection.ts";
import { dailyScheduleId } from "../../rules/insight-daily-run.rules.ts";
import type { InsightRepositories } from "../insight.repositories.ts";
import { MemoryInsightRepositories } from "../memory/memory.insight.repositories.ts";
import { PostgresInsightRepositories } from "../prisma/prisma.insight.repositories.ts";

/** One backend under test: its repositories, and the two project ids the cases read against. */
type Backend = Readonly<{
  repositories: () => InsightRepositories;
  projectId: () => string;
  otherProjectId: () => string;
}>;

const OWNER = "user-owner";
const OTHER = "user-other";
const RAN_AT = Date.UTC(2026, 9, 10, 9, 40);
const BOARD = { kind: "dashboard", id: "dashboard-1", name: "Costs" } as const;

function folded(state: InsightDailyScheduleState): StoredProjection<InsightDailyScheduleState> {
  return foldedAt(state, state.lastRunAt ?? RAN_AT);
}

function foldedAt<State>(state: State, at: number): StoredProjection<State> {
  return {
    state,
    cursor: { acceptedAt: at, eventId: `event_${randomUUID()}` },
    occurredAt: at,
    createdAt: at,
    updatedAt: at,
    version: "2026-10-10",
  };
}

function settled(overrides: Partial<InsightDailyScheduleState> = {}): InsightDailyScheduleState {
  return {
    userId: OWNER,
    boardKind: BOARD.kind,
    boardId: BOARD.id,
    boardName: BOARD.name,
    state: "undecided",
    offReason: null,
    hour: null,
    timezone: null,
    maxInsights: null,
    consecutiveSkips: 0,
    skipStreakSlot: null,
    lastRunId: "run-1",
    lastRunAt: RAN_AT,
    lastRunOutcome: "filed",
    lastRunReason: null,
    lastRunFiled: 2,
    lastRunRenewed: 1,
    lastRunConversationId: "conversation-1",
    ...overrides,
  };
}

function contractCases(backend: Backend): void {
  /** Writes the run row the way the fold does, and answers its schedule id. */
  const store = async ({
    projectId = backend.projectId(),
    ...overrides
  }: Partial<InsightDailyScheduleState> & { projectId?: string } = {}) => {
    const state = settled(overrides);
    const scheduleId = dailyScheduleId({
      projectId,
      userId: state.userId,
      board: { kind: state.boardKind, id: state.boardId },
    });
    await backend.repositories().dailyScheduleProjection.store(folded(state), {
      tenantId: createTenantId(projectId),
      aggregateId: scheduleId,
      key: scheduleId,
    });
    return scheduleId;
  };

  /** Writes the schedule's run in flight row the way its own fold does. */
  const storeStarted = async ({
    scheduleId,
    ...state
  }: Partial<InsightRunInFlightState> & { scheduleId: string }) => {
    const row = { ...NO_RUN_STARTED, ...state };
    await backend.repositories().runInFlightProjection.store(foldedAt(row, RAN_AT), {
      tenantId: createTenantId(backend.projectId()),
      aggregateId: scheduleId,
      key: scheduleId,
    });
  };

  const runsOf = (userId: string, projectId = backend.projectId()) =>
    backend.repositories().dailySchedules.findForUser({ projectId, userId });

  describe("when runs settled for two people on the same board, and one in another project", () => {
    /** @scenario "The run's row is stored per person and board in the project" */
    it("answers each person their own row in the project, and no other", async () => {
      const mine = await store();
      const theirs = await store({ userId: OTHER, lastRunOutcome: "skipped", lastRunFiled: 0 });
      const elsewhere = await store({ projectId: backend.otherProjectId() });

      expect(await runsOf(OWNER)).toEqual([
        {
          id: mine,
          board: BOARD,
          lastRun: {
            at: RAN_AT,
            outcome: "filed",
            reason: null,
            filedCount: 2,
            renewedCount: 1,
            conversationId: "conversation-1",
          },
        },
      ]);
      expect((await runsOf(OTHER)).map(({ id, lastRun }) => [id, lastRun?.outcome])).toEqual([
        [theirs, "skipped"],
      ]);
      expect((await runsOf(OWNER, backend.otherProjectId())).map(({ id }) => id)).toEqual([
        elsewhere,
      ]);
      expect(await runsOf("user-nobody")).toEqual([]);
    });
  });

  describe("when the same person's run on a board settles again", () => {
    it("keeps one row for the board, reading the later run", async () => {
      const scheduleId = await store();
      await store({
        lastRunId: "run-2",
        lastRunAt: RAN_AT + 86_400_000,
        lastRunOutcome: "failed",
        lastRunReason: "bad_output",
        lastRunFiled: 0,
        lastRunRenewed: 0,
        boardName: "Costs and errors",
      });

      expect(await runsOf(OWNER)).toEqual([
        {
          id: scheduleId,
          board: { ...BOARD, name: "Costs and errors" },
          lastRun: {
            at: RAN_AT + 86_400_000,
            outcome: "failed",
            reason: "bad_output",
            filedCount: 0,
            renewedCount: 0,
            conversationId: "conversation-1",
          },
        },
      ]);
    });

    it("reads the stored row back as the fold wrote it", async () => {
      const scheduleId = await store({ boardKind: "template", boardId: "llm-costs" });

      const read = await backend.repositories().dailyScheduleProjection.get(scheduleId, {
        tenantId: createTenantId(backend.projectId()),
        aggregateId: scheduleId,
      });
      const elsewhere = await backend.repositories().dailyScheduleProjection.get(scheduleId, {
        tenantId: createTenantId(backend.otherProjectId()),
        aggregateId: scheduleId,
      });

      expect(read.kind === "folded" && read.projection.state).toEqual(
        settled({ boardKind: "template", boardId: "llm-costs" }),
      );
      expect(elsewhere).toEqual({ kind: "empty" });
    });
  });

  describe("when a person has runs on several boards", () => {
    it("lists the newest run first", async () => {
      await store({ boardId: "dashboard-old", lastRunAt: RAN_AT - 86_400_000 });
      await store({ boardId: "dashboard-new", lastRunAt: RAN_AT });

      expect((await runsOf(OWNER)).map(({ board }) => board.id)).toEqual([
        "dashboard-new",
        "dashboard-old",
      ]);
    });
  });

  const ON = { state: "on", hour: 9, timezone: "Europe/Amsterdam", maxInsights: 5 } as const;

  describe("when rows are on, off and undecided in two projects", () => {
    const ownProjects = () => [backend.projectId(), backend.otherProjectId()];
    /** The table is shared with other suites: only this suite's own projects are compared. */
    const decided = async (take: number) =>
      (await backend.repositories().dailySchedules.findDecided({ take })).filter((row) =>
        ownProjects().includes(row.projectId),
      );

    /** @scenario "The operator's read of the rows is the same in both tiers" */
    it("reads the ones that are on first, then by id, and never an undecided one", async () => {
      const on = [
        await store(ON),
        await store({ ...ON, userId: OTHER }),
        await store({ ...ON, projectId: backend.otherProjectId() }),
      ];
      const off = await store({
        boardId: "dashboard-off",
        state: "off",
        offReason: "skipped_days",
      });
      await store({ boardId: "dashboard-undecided" });

      const rows = await decided(500);

      expect(rows.map(({ state, scheduleId }) => [state, scheduleId])).toEqual([
        ...on.toSorted().map((scheduleId) => ["on", scheduleId]),
        ["off", off],
      ]);
      expect(rows.at(-1)).toMatchObject({
        projectId: backend.projectId(),
        userId: OWNER,
        board: { ...BOARD, id: "dashboard-off" },
        offReason: "skipped_days",
        settings: null,
        consecutiveSkips: 0,
      });
      expect(await backend.repositories().dailySchedules.findDecided({ take: 2 })).toHaveLength(2);
    });

    it("reads a project's rows that are on for everyone, or for one person", async () => {
      const mine = await store(ON);
      const theirs = await store({ ...ON, userId: OTHER });
      await store({ ...ON, projectId: backend.otherProjectId() });
      await store({ boardId: "dashboard-off", state: "off" });
      const inProject = (userId?: string) =>
        backend
          .repositories()
          .dailySchedules.findOnInProject({ projectId: backend.projectId(), userId });

      expect((await inProject()).map(({ scheduleId }) => scheduleId).toSorted()).toEqual(
        [mine, theirs].toSorted(),
      );
      expect(await inProject(OTHER)).toEqual([
        {
          scheduleId: theirs,
          projectId: backend.projectId(),
          userId: OTHER,
          board: BOARD,
          settings: { hour: 9, timezone: "Europe/Amsterdam", maxInsights: 5 },
        },
      ]);
      expect(await inProject("user-nobody")).toEqual([]);
    });
  });

  const settingOf = ({
    userId,
    scheduleId,
    projectId = backend.projectId(),
  }: {
    userId: string;
    scheduleId: string;
    projectId?: string;
  }) => backend.repositories().dailySchedules.findSetting({ projectId, userId, scheduleId });

  describe("when the system turned a row off after skipped days", () => {
    /** @scenario "Why a schedule is off and its skipped days are stored with its row" */
    it("answers its person off with the reason, and reads the count back as stored", async () => {
      const skipped = { consecutiveSkips: 7, skipStreakSlot: RAN_AT - 60_000 };
      const state = { ...ON, state: "off", offReason: "skipped_days", ...skipped } as const;
      const scheduleId = await store(state);

      const read = await backend.repositories().dailyScheduleProjection.get(scheduleId, {
        tenantId: createTenantId(backend.projectId()),
        aggregateId: scheduleId,
      });

      expect(await settingOf({ userId: OWNER, scheduleId })).toMatchObject([
        { state: "off", offReason: "skipped_days" },
      ]);
      expect(read.kind === "folded" && read.projection.state).toEqual(settled(state));
    });
  });

  describe("when two people set the same board, one on and one off", () => {
    /** @scenario "A daily run setting is stored per person and board in the project" */
    it("answers each person their own setting, and none through another's schedule", async () => {
      const mine = await store(ON);
      const theirs = await store({ userId: OTHER, state: "off", lastRunId: null, lastRunAt: null });

      expect(await settingOf({ userId: OWNER, scheduleId: mine })).toEqual([
        {
          state: "on",
          settings: { hour: 9, timezone: "Europe/Amsterdam", maxInsights: 5 },
          lastRun: {
            at: RAN_AT,
            outcome: "filed",
            reason: null,
            filedCount: 2,
            renewedCount: 1,
            conversationId: "conversation-1",
            runId: "run-1",
          },
          offReason: null,
          runInFlight: null,
        },
      ]);
      expect(await settingOf({ userId: OTHER, scheduleId: theirs })).toEqual([
        { state: "off", settings: null, lastRun: null, offReason: null, runInFlight: null },
      ]);
      expect(await settingOf({ userId: OTHER, scheduleId: mine })).toEqual([]);
      expect(
        await settingOf({ userId: OWNER, scheduleId: mine, projectId: backend.otherProjectId() }),
      ).toEqual([]);
      expect(await settingOf({ userId: OWNER, scheduleId: "insightschedule_none" })).toEqual([]);
    });
  });

  describe("when a schedule's run in flight row names a run that started after its last", () => {
    /** @scenario "A started run names its conversation on the board's row" */
    it("answers that run in flight beside the last run", async () => {
      const scheduleId = await store(ON);
      const started = { runId: "run-2", conversationId: "conversation-2", startedAt: RAN_AT + 1 };
      await storeStarted({ scheduleId, ...started });

      const [setting] = await settingOf({ userId: OWNER, scheduleId });

      expect(setting?.runInFlight).toEqual(started);
      expect(setting?.lastRun).toMatchObject({ runId: "run-1" });
      expect(setting?.lastRun).not.toHaveProperty("startedAt");
    });
  });

  describe("when a schedule's run in flight row kept the start of its last run", () => {
    /** @scenario "A settled run keeps when it started on the board's row" */
    it("answers no run in flight, and that start as the last run's", async () => {
      const scheduleId = await store(ON);
      await storeStarted({
        scheduleId,
        runId: "run-1",
        conversationId: "conversation-1",
        startedAt: RAN_AT - 60_000,
      });

      const [setting] = await settingOf({ userId: OWNER, scheduleId });

      expect(setting?.runInFlight).toBeNull();
      expect(setting?.lastRun).toMatchObject({ runId: "run-1", startedAt: RAN_AT - 60_000 });
    });
  });

  describe("when a schedule's run in flight row took a newer outcome than its run row", () => {
    /** The newer run's outcome, as the run in flight row keeps it. */
    const NEWER = {
      at: RAN_AT + 60_000,
      outcome: "skipped",
      reason: "no_access",
      filedCount: 0,
      renewedCount: 0,
      conversationId: null,
    } as const;
    const storeNewer = async () => {
      const scheduleId = await store(ON);
      await storeStarted({
        scheduleId,
        runId: "run-2",
        conversationId: "conversation-2",
        startedAt: RAN_AT + 1,
        lastSettledRunId: "run-2",
        lastRunAt: NEWER.at,
        lastRunOutcome: NEWER.outcome,
        lastRunReason: NEWER.reason,
        lastRunFiled: NEWER.filedCount,
        lastRunRenewed: NEWER.renewedCount,
        lastRunConversationId: NEWER.conversationId,
        newestRunId: "run-2",
        newestRunSlot: RAN_AT,
        newestRunSince: RAN_AT + 1,
      });
      return scheduleId;
    };

    it("answers the run in flight row's last run on the setting, with its start", async () => {
      const scheduleId = await storeNewer();

      const [setting] = await settingOf({ userId: OWNER, scheduleId });

      expect(setting?.runInFlight).toBeNull();
      expect(setting?.lastRun).toEqual({ ...NEWER, runId: "run-2", startedAt: RAN_AT + 1 });
    });

    it("answers the run in flight row's last run on the person's run list", async () => {
      const scheduleId = await storeNewer();
      await store({ boardId: "dashboard-other", lastRunAt: RAN_AT + 30_000 });

      const runs = await runsOf(OWNER);

      expect(runs.map(({ id }) => id)[0]).toBe(scheduleId);
      expect(runs[0]?.lastRun).toEqual(NEWER);
    });

    it("answers the run in flight row's last run on the operator's list", async () => {
      const scheduleId = await storeNewer();

      const decided = await backend.repositories().dailySchedules.findDecided({ take: 500 });

      expect(decided.find((row) => row.scheduleId === scheduleId)?.lastRun).toEqual(NEWER);
    });
  });

  describe("when schedules are on in two projects, beside ones that are off or undecided", () => {
    /** Every page from the start, kept to the two projects this backend owns. */
    const onSchedules = async ({ take }: { take: number }) => {
      const mine = [backend.projectId(), backend.otherProjectId()];
      const found = [];
      let afterId: string | null = null;
      for (;;) {
        const page = await backend.repositories().dailySchedules.findOnPage({ afterId, take });
        const last = page.at(-1);
        if (!last) return found;
        found.push(...page.filter(({ projectId }) => mine.includes(projectId)));
        afterId = last.scheduleId;
      }
    };

    /** @scenario "A reconcile pass reads every project's schedules that are on" */
    it("pages through the ones that are on, in every project, by id and once each", async () => {
      const here = await store(ON);
      const there = await store({ ...ON, projectId: backend.otherProjectId(), userId: OTHER });
      await store({
        boardId: "dashboard-off",
        state: "off",
        hour: 9,
        timezone: "UTC",
        maxInsights: 1,
      });
      await store({ boardId: "dashboard-undecided" });
      const expected = [
        { scheduleId: here, projectId: backend.projectId(), userId: OWNER },
        { scheduleId: there, projectId: backend.otherProjectId(), userId: OTHER },
      ].toSorted((a, b) => (a.scheduleId < b.scheduleId ? -1 : 1));

      const onePerPage = await onSchedules({ take: 1 });
      const allAtOnce = await onSchedules({ take: 100 });

      expect(onePerPage).toEqual(
        expected.map((schedule) => ({
          ...schedule,
          board: BOARD,
          settings: { hour: 9, timezone: "Europe/Amsterdam", maxInsights: 5 },
        })),
      );
      expect(allAtOnce).toEqual(onePerPage);
    });
  });
}

describe("given the memory daily schedule repositories", () => {
  let repositories: InsightRepositories;

  beforeEach(() => {
    repositories = MemoryInsightRepositories.create();
  });

  contractCases({
    repositories: () => repositories,
    projectId: () => "project-1",
    otherProjectId: () => "project-2",
  });
});

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createTestLogger().logger,
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

function database(): PrismaClient {
  if (connection === null) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
  return connection.client;
}

describe.skipIf(!databaseUrl)("given the Postgres daily schedule repositories", () => {
  const projectId = `insight-run-contract-${randomUUID()}`;
  const otherProjectId = `${projectId}-other`;

  const clean = () =>
    cleanupTestRows(database(), [
      ["insightDailyScheduleProjection", { projectId }],
      ["insightDailyScheduleProjection", { projectId: otherProjectId }],
      ["insightRunInFlightProjection", { projectId }],
      ["insightRunInFlightProjection", { projectId: otherProjectId }],
    ]);

  beforeEach(clean);

  afterAll(async () => {
    try {
      await clean();
    } finally {
      await connection?.closeOnce();
    }
  });

  contractCases({
    repositories: () => PostgresInsightRepositories.create({ prisma: database() }),
    projectId: () => projectId,
    otherProjectId: () => otherProjectId,
  });

  describe("when a row is folded with and without a setting", () => {
    const storedRow = async (state: InsightDailyScheduleState) => {
      const scheduleId = dailyScheduleId({ projectId, userId: OWNER, board: BOARD });
      await PostgresInsightRepositories.create({
        prisma: database(),
      }).dailyScheduleProjection.store(folded(state), {
        tenantId: createTenantId(projectId),
        aggregateId: scheduleId,
        key: scheduleId,
      });
      return database().insightDailyScheduleProjection.findFirst({
        where: { id: scheduleId, projectId },
      });
    };

    it("keeps the schedule's own columns at their defaults for a row only a run wrote", async () => {
      expect(await storedRow(settled())).toMatchObject({
        state: "undecided",
        hour: null,
        timezone: null,
        maxInsights: null,
      });
    });

    it("holds how many insights the run renewed in a column of its own", async () => {
      expect(await storedRow(settled({ lastRunFiled: 0, lastRunRenewed: 3 }))).toMatchObject({
        lastRunFiled: 0,
        lastRunRenewed: 3,
      });
    });

    it("writes the setting into the schedule's own columns", async () => {
      const setting = { state: "on", hour: 17, timezone: "Asia/Kolkata", maxInsights: 10 } as const;

      expect(await storedRow(settled(setting))).toMatchObject(setting);
    });
  });
});
