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
  const at = state.lastRunAt ?? RAN_AT;
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
    hour: null,
    timezone: null,
    maxInsights: null,
    lastRunId: "run-1",
    lastRunAt: RAN_AT,
    lastRunOutcome: "filed",
    lastRunReason: null,
    lastRunFiled: 2,
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

  const settingOf = ({
    userId,
    scheduleId,
    projectId = backend.projectId(),
  }: {
    userId: string;
    scheduleId: string;
    projectId?: string;
  }) => backend.repositories().dailySchedules.findSetting({ projectId, userId, scheduleId });

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
            conversationId: "conversation-1",
          },
        },
      ]);
      expect(await settingOf({ userId: OTHER, scheduleId: theirs })).toEqual([
        { state: "off", settings: null, lastRun: null },
      ]);
      expect(await settingOf({ userId: OTHER, scheduleId: mine })).toEqual([]);
      expect(
        await settingOf({ userId: OWNER, scheduleId: mine, projectId: backend.otherProjectId() }),
      ).toEqual([]);
      expect(await settingOf({ userId: OWNER, scheduleId: "insightschedule_none" })).toEqual([]);
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
        lastRunRenewed: null,
      });
    });

    it("writes the setting into the schedule's own columns", async () => {
      const setting = { state: "on", hour: 17, timezone: "Asia/Kolkata", maxInsights: 10 } as const;

      expect(await storedRow(settled(setting))).toMatchObject({ ...setting, lastRunRenewed: null });
    });
  });
});
