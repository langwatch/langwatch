import type { Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";
import type { ScheduledJobRepository } from "~/server/app-layer/scheduler/scheduler.types";
import type { TriggerRepository } from "../repositories/trigger.repository";
import { TriggerService } from "../trigger.service";

function makeScheduledJobs(): ScheduledJobRepository {
  return {
    findDue: vi.fn(async () => []),
    earliestActiveNextRunAt: vi.fn(async () => null),
    claim: vi.fn(async () => true),
    upsertForTarget: vi.fn(async () => undefined),
    deactivateForTarget: vi.fn(async () => undefined),
    findAllForProject: vi.fn(async () => []),
    listForOps: vi.fn(async () => []),
  };
}

const triggerRepo = {} as unknown as TriggerRepository;

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
});
