import type { Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";
import type {
  ScheduledJobRecord,
  ScheduledJobRepository,
} from "~/server/app-layer/scheduler/scheduler.types";
import {
  NullTriggerRepository,
  type ReportScheduleTarget,
  type TriggerRepository,
} from "@langwatch/automations/repositories/trigger.repository";
import { TriggerService } from "../trigger.service";

function makeScheduledJobs(
  existingJobs: ScheduledJobRecord[] = [],
): ScheduledJobRepository {
  return {
    findDue: vi.fn(async () => []),
    earliestActiveNextRunAt: vi.fn(async () => null),
    claim: vi.fn(async () => true),
    settleClaim: vi.fn(async () => true),
    upsertForTarget: vi.fn(async () => undefined),
    deactivateForTarget: vi.fn(async () => undefined),
    findAllForProject: vi.fn(async ({ projectId }: { projectId: string }) =>
      existingJobs.filter((j) => j.projectId === projectId),
    ),
    listForOps: vi.fn(async () => []),
  };
}

/** A valid report `actionParams` (weekly, so it clears the 15-min interval floor). */
function reportActionParams(): Record<string, unknown> {
  return {
    source: { kind: "customGraph", customGraphId: "g1" },
    schedule: { cron: "0 9 * * 1", timezone: "UTC" },
  };
}

function makeTriggerRepo(
  reports: ReportScheduleTarget[] = [],
): TriggerRepository {
  // Null base supplies the authoring surface (findById / create / update / …)
  // — these tests exercise the report-schedule sync only.
  return Object.assign(new NullTriggerRepository(), {
    findActiveForProject: vi.fn(async () => []),
    findActiveReportTargets: vi.fn(async () => reports),
    claimSend: vi.fn(async () => true),
    isSendClaimed: vi.fn(async () => false),
    updateLastRunAt: vi.fn(async () => undefined),
  });
}

function makeScheduledJobRecord(
  overrides: Partial<ScheduledJobRecord> & {
    targetId: string;
    projectId: string;
  },
): ScheduledJobRecord {
  return {
    id: `job-${overrides.targetId}`,
    targetType: "reportTrigger",
    cron: "0 9 * * 1",
    timezone: "UTC",
    nextRunAt: new Date("2026-07-20T09:00:00.000Z"),
    lastSlot: null,
    currentSlot: null,
    attempts: 0,
    lastError: null,
    active: true,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

const triggerRepo = makeTriggerRepo();

describe("TriggerService report-schedule sync", () => {
  describe("syncReportSchedule", () => {
    describe("given a report with a weekly cron", () => {
      it("upserts a reportTrigger ScheduledJob with a computed nextRunAt and wakes the fleet", async () => {
        const scheduledJobs = makeScheduledJobs();
        const publish = vi.fn(async () => 1);
        const redis = { publish } as unknown as Redis;
        const svc = new TriggerService(triggerRepo, scheduledJobs, redis);

        await svc.syncReportSchedule({
          projectId: "proj-1",
          triggerId: "trig-1",
          cron: "0 9 * * 1",
          timezone: "Europe/Amsterdam",
        });

        expect(scheduledJobs.upsertForTarget).toHaveBeenCalledTimes(1);
        const arg = (scheduledJobs.upsertForTarget as ReturnType<typeof vi.fn>)
          .mock.calls[0]![0];
        expect(arg).toMatchObject({
          projectId: "proj-1",
          targetType: "reportTrigger",
          targetId: "trig-1",
          cron: "0 9 * * 1",
          timezone: "Europe/Amsterdam",
        });
        expect(arg.nextRunAt).toBeInstanceOf(Date);
        expect(arg.nextRunAt.getTime()).toBeGreaterThan(Date.now());
        // best-effort cross-pod wake
        expect(publish).toHaveBeenCalledWith("scheduler:wake", "1");
      });
    });

    describe("given no scheduler repository (test/null wiring)", () => {
      it("is a safe no-op", async () => {
        const svc = new TriggerService(triggerRepo);
        await expect(
          svc.syncReportSchedule({
            projectId: "p",
            triggerId: "t",
            cron: "0 9 * * 1",
            timezone: "UTC",
          }),
        ).resolves.toBeUndefined();
      });
    });
  });

  describe("removeReportSchedule", () => {
    it("deactivates the reportTrigger ScheduledJob for the target", async () => {
      const scheduledJobs = makeScheduledJobs();
      const svc = new TriggerService(triggerRepo, scheduledJobs, null);

      await svc.removeReportSchedule({ projectId: "proj-1", triggerId: "trig-1" });

      expect(scheduledJobs.deactivateForTarget).toHaveBeenCalledWith({
        projectId: "proj-1",
        targetType: "reportTrigger",
        targetId: "trig-1",
      });
    });
  });

  describe("reconcileReportSchedules (durable self-heal)", () => {
    describe("given an active report whose ScheduledJob write never landed", () => {
      it("repairs it by creating the missing schedule from its actionParams", async () => {
        // Failure injection: the report Trigger row exists (active report) but the
        // second, non-atomic ScheduledJob write was lost — so findAllForProject
        // returns NO row for it. The report must not stay unscheduled forever.
        const repo = makeTriggerRepo([
          {
            id: "trig-1",
            projectId: "proj-1",
            actionParams: reportActionParams(),
          },
        ]);
        const scheduledJobs = makeScheduledJobs([]); // no existing schedule
        const svc = new TriggerService(repo, scheduledJobs, null);

        const result = await svc.reconcileReportSchedules();

        expect(result).toEqual({ repaired: 1 });
        expect(scheduledJobs.upsertForTarget).toHaveBeenCalledTimes(1);
        const arg = (scheduledJobs.upsertForTarget as ReturnType<typeof vi.fn>)
          .mock.calls[0]![0];
        expect(arg).toMatchObject({
          projectId: "proj-1",
          targetType: "reportTrigger",
          targetId: "trig-1",
          cron: "0 9 * * 1",
          timezone: "UTC",
        });
        expect(arg.nextRunAt).toBeInstanceOf(Date);
        expect(arg.nextRunAt.getTime()).toBeGreaterThan(Date.now());
      });
    });

    describe("given an active report that is PAUSED (an inactive schedule row exists)", () => {
      it("leaves it paused — reconciliation never resurrects a paused schedule", async () => {
        const repo = makeTriggerRepo([
          {
            id: "trig-1",
            projectId: "proj-1",
            actionParams: reportActionParams(),
          },
        ]);
        // A paused report keeps an INACTIVE ScheduledJob row; findAllForProject
        // returns it (it is not filtered by active), so reconciliation must skip.
        const scheduledJobs = makeScheduledJobs([
          makeScheduledJobRecord({
            targetId: "trig-1",
            projectId: "proj-1",
            active: false,
          }),
        ]);
        const svc = new TriggerService(repo, scheduledJobs, null);

        const result = await svc.reconcileReportSchedules();

        expect(result).toEqual({ repaired: 0 });
        expect(scheduledJobs.upsertForTarget).not.toHaveBeenCalled();
      });
    });

    describe("given an active report that is already scheduled", () => {
      it("does not touch its live calendar", async () => {
        const repo = makeTriggerRepo([
          {
            id: "trig-1",
            projectId: "proj-1",
            actionParams: reportActionParams(),
          },
        ]);
        const scheduledJobs = makeScheduledJobs([
          makeScheduledJobRecord({
            targetId: "trig-1",
            projectId: "proj-1",
            active: true,
          }),
        ]);
        const svc = new TriggerService(repo, scheduledJobs, null);

        const result = await svc.reconcileReportSchedules();

        expect(result).toEqual({ repaired: 0 });
        expect(scheduledJobs.upsertForTarget).not.toHaveBeenCalled();
      });
    });

    describe("given a report whose actionParams do not parse", () => {
      it("skips it rather than creating a broken schedule", async () => {
        const repo = makeTriggerRepo([
          { id: "trig-1", projectId: "proj-1", actionParams: { legacy: true } },
        ]);
        const scheduledJobs = makeScheduledJobs([]);
        const svc = new TriggerService(repo, scheduledJobs, null);

        const result = await svc.reconcileReportSchedules();

        expect(result).toEqual({ repaired: 0 });
        expect(scheduledJobs.upsertForTarget).not.toHaveBeenCalled();
      });
    });

    describe("given no scheduler repository (test/null wiring)", () => {
      it("is a safe no-op", async () => {
        const svc = new TriggerService(makeTriggerRepo());
        await expect(svc.reconcileReportSchedules()).resolves.toEqual({
          repaired: 0,
        });
      });
    });
  });
});
