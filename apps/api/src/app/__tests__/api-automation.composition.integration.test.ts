/**
 * The report calendar, driven through the real `automation.*` tRPC surface.
 *
 * The proof this file exists for is a two-process one. A report is authored on
 * the interactive process and fired by the worker, and the only thing they
 * share is one `ScheduledJob` row. So every assertion here is made against
 * `PrismaScheduledJobStore` — the SAME class the worker's loop claims through
 * (`apps/worker/src/app/worker-report-schedule.composition.ts`) — over one
 * in-memory table. A row this process wrote in a shape that class cannot read
 * back would fail here rather than as a report that silently never sends.
 *
 * Everything below the transport is the real thing: the composition, the
 * automation application, `ReportScheduleService`, and Eventing's own store.
 * Only Postgres and Redis are fakes.
 */
import { declareAuthzMiddleware } from "@langwatch/authz-contract";
import type { AppTrpcPolicyMiddlewares } from "@langwatch/api/trpc";
import {
  REPORT_SCHEDULER_TARGET_TYPE,
  TriggerAction,
  type AutomationPlanProvider,
} from "@langwatch/automation-contract";
import { AutomationProviderRegistryAdapter } from "@langwatch/automation-server";
import { PrismaScheduledJobStore } from "@langwatch/eventing/server";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { MonitorService } from "@langwatch/monitor-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { composeApiAutomationApp } from "../api-automation.composition";
import { createAutomationTrpcRouter } from "../../features/automation/automation-trpc.mount";

const PROJECT_ID = "project_report_calendar";
const USER_ID = "user_report_calendar";
/** Mondays at 09:00, the drawer's own default cadence. */
const MONDAY_MORNING = "0 9 * * 1";
/** Fridays at 17:00 — a different weekday AND a different hour, so a moved row is unmistakable. */
const FRIDAY_EVENING = "0 17 * * 5";
/** The channel `SchedulerService` subscribes its loop to on every worker pod. */
const SCHEDULER_WAKE_CHANNEL = "scheduler:wake";

type Row = Record<string, unknown>;

/** The `Trigger` columns Postgres defaults, which the writing path never sends. */
const TRIGGER_COLUMN_DEFAULTS: Row = {
  active: true,
  deleted: false,
  pausedReason: null,
  pausedAt: null,
  message: null,
  alertType: null,
  customGraphId: null,
  filterQuery: null,
  notificationCadence: "immediate",
  traceDebounceMs: 0,
  slackTemplateType: null,
  slackTemplate: null,
  emailSubjectTemplate: null,
  emailBodyTemplate: null,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
};

/**
 * The two tables this path writes, in memory.
 *
 * `scheduledJob` is deliberately a list of plain rows rather than a mock: the
 * store's upsert is update-first-then-create, and only a table that actually
 * remembers what it holds can tell "moved the existing row" apart from "wrote
 * a second one".
 */
function createFakePostgres() {
  const triggers = new Map<string, Row>();
  const scheduledJobs: Row[] = [];

  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([column, value]) => row[column] === value);

  const prisma = {
    trigger: {
      create: async ({ data }: { data: Row }) => {
        const row = { ...TRIGGER_COLUMN_DEFAULTS, ...data };
        triggers.set(String(row.id), row);
        return row;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const existing = triggers.get(String(where.id));
        if (!existing) throw new Error(`No Trigger ${String(where.id)}`);
        const row = { ...existing, ...data };
        triggers.set(String(row.id), row);
        return row;
      },
      findFirst: async ({ where }: { where: Row }) =>
        [...triggers.values()].find((row) => matches(row, where)) ?? null,
      findMany: async ({ where }: { where: Row }) =>
        [...triggers.values()].filter((row) => matches(row, where)),
    },
    scheduledJob: {
      create: async ({ data }: { data: Row }) => {
        const row = { ...data, lastSlot: null, currentSlot: null };
        scheduledJobs.push(row);
        return row;
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const affected = scheduledJobs.filter((row) => matches(row, where));
        for (const row of affected) Object.assign(row, data);
        return { count: affected.length };
      },
      findMany: async ({ where }: { where: Row }) =>
        scheduledJobs.filter((row) => matches(row, where)),
    },
  };

  return { prisma: prisma as unknown as PrismaClient, scheduledJobs };
}

/**
 * A stand-in whose every member refuses by name.
 *
 * These are the collaborators the report path must never reach. A refusal is
 * what makes that assertion rather than an assumption: a save that started
 * asking the project directory or the plan provider for anything would fail
 * here instead of passing quietly.
 */
function refuse<T extends object>(capability: string): T {
  return new Proxy({} as T, {
    get: () => () => {
      throw new Error(`The report calendar reached ${capability}, which it composes nothing for.`);
    },
    has: () => true,
  });
}

/**
 * The one provider registry both the application and the transport read
 * through, over a cipher that refuses.
 *
 * One registry rather than two, because that is the deployment's shape: the
 * transport redacts a row with the same registry the application stored it
 * with. The refusing cipher is the assertion that a report over email carries
 * no secret at all — a path that started encrypting one would fail here.
 */
function createProviderRegistry(): AutomationProviderRegistryAdapter {
  const refuseSecret = (): never => {
    throw new Error("A report over email stores no secret.");
  };

  return AutomationProviderRegistryAdapter.create({
    encrypt: refuseSecret,
    decrypt: refuseSecret,
  });
}

function harness() {
  const { prisma, scheduledJobs } = createFakePostgres();
  const providers = createProviderRegistry();
  const publish = vi.fn(async () => 1);
  const redis = { publish } as unknown as RedisConnection;

  const automation = composeApiAutomationApp({
    prisma,
    projects: refuse<ProjectService>("the project directory"),
    monitors: refuse<MonitorService>("the monitor directory"),
    featureFlags: refuse<FeatureFlagService>("the rollout gate"),
    plans: refuse<AutomationPlanProvider>("the plan provider"),
    providers,
    unsubscribeSecret: "unsubscribe-secret",
    baseHost: "https://app.langwatch.test",
    redis,
    processName: "api-test",
  });

  type TestContext = {
    app: { automation: typeof automation };
    actor(): { id: string };
    session: { user: { email?: string | null } } | null;
  };

  const trpc = initTRPC.context<TestContext>().create();
  const passThrough = ({ next }: { next: () => Promise<unknown> }) => next();
  const middlewares: AppTrpcPolicyMiddlewares = {
    tracer: passThrough,
    logger: passThrough,
    handledError: passThrough,
    scopeLineageGuard: () => passThrough,
    declaredCheck: (declaration) =>
      declareAuthzMiddleware(
        declaration,
        passThrough as unknown as (params: never) => Promise<unknown>,
      ),
    enforceCheck: passThrough,
    auditMutations: passThrough,
  };

  const router = createAutomationTrpcRouter({
    root: trpc,
    protectedProcedure: trpc.procedure,
    middlewares,
    ports: {
      rateLimit: async () => ({ allowed: true, resetAt: 0 }),
      providers,
      listSlackChannels: async () => ({ channels: [], gaps: [] }),
    },
  });

  const caller = router.createCaller({
    app: { automation },
    actor: () => ({ id: USER_ID }),
    session: { user: { email: "member@langwatch.test" } },
  });

  /** The calendar as the WORKER reads it: Eventing's own store, same table. */
  const workerCalendar = new PrismaScheduledJobStore(prisma);

  const saveReport = (overrides?: { triggerId?: string; cron?: string }) =>
    caller.upsert({
      projectId: PROJECT_ID,
      ...(overrides?.triggerId ? { triggerId: overrides.triggerId } : {}),
      name: "Weekly quality digest",
      action: TriggerAction.SEND_EMAIL,
      filters: {},
      actionParams: { members: ["ops@langwatch.test"] },
      templates: {},
      report: {
        source: { kind: "traceQuery", filters: {}, topN: 5 },
        schedule: { cron: overrides?.cron ?? MONDAY_MORNING, timezone: "UTC" },
        compareToPrevious: false,
      },
    });

  return { caller, publish, scheduledJobs, workerCalendar, saveReport };
}

/**
 * The calendar instant, read the way a person reads a cron line.
 *
 * `isAhead` is part of the reading rather than a separate assertion: a
 * resolver that answered with the cron's LAST occurrence lands on the right
 * weekday and hour, comes due immediately, and sends a report for a window
 * that already went out.
 */
function whenItNextRuns(nextRunAt: unknown): {
  weekday: number;
  hour: number;
  minute: number;
  isAhead: boolean;
} {
  const instant = nextRunAt as Date;
  return {
    weekday: instant.getUTCDay(),
    hour: instant.getUTCHours(),
    minute: instant.getUTCMinutes(),
    isAhead: instant.getTime() > Date.now(),
  };
}

describe("the API process's report calendar", () => {
  describe("when a member saves a report schedule", () => {
    /** @scenario "Saving a report schedules it for its next send" */
    it("writes the row the worker's scheduler claims, in that store's own shape", async () => {
      const { saveReport, workerCalendar } = harness();

      const trigger = await saveReport();

      const rows = await workerCalendar.findAllForProject({
        projectId: PROJECT_ID,
        targetType: REPORT_SCHEDULER_TARGET_TYPE,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        projectId: PROJECT_ID,
        targetType: REPORT_SCHEDULER_TARGET_TYPE,
        targetId: trigger.id,
        cron: MONDAY_MORNING,
        timezone: "UTC",
        active: true,
      });
      // The calendar instant itself, not just its presence: a row whose
      // nextRunAt did not resolve the author's cron comes due on the wrong day.
      expect(whenItNextRuns(rows[0]?.nextRunAt)).toEqual({
        weekday: 1,
        hour: 9,
        minute: 0,
        isAhead: true,
      });
    });

    /** @scenario "A saved report starts counting without waiting for a restart" */
    it("publishes the wake the worker's loop is subscribed to", async () => {
      const { saveReport, publish } = harness();

      await saveReport();

      expect(publish).toHaveBeenCalledWith(SCHEDULER_WAKE_CHANNEL, "1");
    });
  });

  describe("when the author moves an existing report to a new cadence", () => {
    /** @scenario "Changing a report's cadence moves its next send" */
    it("moves the one row rather than leaving the old cadence behind", async () => {
      const { saveReport, workerCalendar, scheduledJobs } = harness();
      const trigger = await saveReport();

      await saveReport({ triggerId: trigger.id, cron: FRIDAY_EVENING });

      expect(scheduledJobs).toHaveLength(1);
      const rows = await workerCalendar.findAllForProject({
        projectId: PROJECT_ID,
        targetType: REPORT_SCHEDULER_TARGET_TYPE,
      });
      expect(rows[0]).toMatchObject({ targetId: trigger.id, cron: FRIDAY_EVENING, active: true });
      expect(whenItNextRuns(rows[0]?.nextRunAt)).toEqual({
        weekday: 5,
        hour: 17,
        minute: 0,
        isAhead: true,
      });
    });
  });

  describe("when a report is paused", () => {
    /** @scenario "Pausing a report takes it off the schedule" */
    it("retires the calendar row so the slot stops being claimed", async () => {
      const { caller, saveReport, workerCalendar } = harness();
      const trigger = await saveReport();

      await caller.toggleTrigger({ projectId: PROJECT_ID, triggerId: trigger.id, active: false });

      const rows = await workerCalendar.findAllForProject({
        projectId: PROJECT_ID,
        targetType: REPORT_SCHEDULER_TARGET_TYPE,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ targetId: trigger.id, active: false });
    });

    /** @scenario "Resuming a report puts it back on the schedule" */
    it("re-arms the same row when the report is resumed", async () => {
      const { caller, saveReport, workerCalendar, scheduledJobs } = harness();
      const trigger = await saveReport();
      await caller.toggleTrigger({ projectId: PROJECT_ID, triggerId: trigger.id, active: false });

      await caller.toggleTrigger({ projectId: PROJECT_ID, triggerId: trigger.id, active: true });

      expect(scheduledJobs).toHaveLength(1);
      const rows = await workerCalendar.findAllForProject({
        projectId: PROJECT_ID,
        targetType: REPORT_SCHEDULER_TARGET_TYPE,
      });
      expect(rows[0]).toMatchObject({ targetId: trigger.id, cron: MONDAY_MORNING, active: true });
      expect(whenItNextRuns(rows[0]?.nextRunAt)).toEqual({
        weekday: 1,
        hour: 9,
        minute: 0,
        isAhead: true,
      });
    });
  });

  describe("when a report is deleted", () => {
    /** @scenario "Deleting a report takes it off the schedule" */
    it("retires the calendar row with the automation", async () => {
      const { caller, saveReport, workerCalendar } = harness();
      const trigger = await saveReport();

      await caller.deleteById({ projectId: PROJECT_ID, triggerId: trigger.id });

      const rows = await workerCalendar.findAllForProject({
        projectId: PROJECT_ID,
        targetType: REPORT_SCHEDULER_TARGET_TYPE,
      });
      expect(rows[0]).toMatchObject({ targetId: trigger.id, active: false });
    });
  });

  describe("when the automations page asks what is scheduled", () => {
    /** @scenario "The automations page shows the next send that will actually happen" */
    it("answers from the row the worker's scheduler reads, not an empty set", async () => {
      const { caller, saveReport } = harness();
      const trigger = await saveReport();

      const schedules = await caller.getReportSchedules({ projectId: PROJECT_ID });

      expect(schedules).toHaveLength(1);
      expect(schedules[0]).toMatchObject({ triggerId: trigger.id, active: true, lastRunAt: null });
      expect(whenItNextRuns(schedules[0]?.nextRunAt)).toEqual({
        weekday: 1,
        hour: 9,
        minute: 0,
        isAhead: true,
      });
    });
  });
});
