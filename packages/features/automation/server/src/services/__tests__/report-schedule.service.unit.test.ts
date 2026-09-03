import { describe, expect, it } from "vitest";
import { AutomationClockPort } from "../../ports/automation-clock.port";
import { ScheduledJobStorePort, type ScheduledJobRecord } from "../../ports/scheduled-jobs.port";
import { SchedulerWakePort } from "../../ports/scheduler-wake.port";
import type {
  ReportScheduleTarget,
  TriggerRepository,
} from "../../repositories/trigger.repository";
import { ReportScheduleService } from "../report-schedule.service";

/** Only the one read the reconcile sweep makes; the rest is not this test's subject. */
function reportTargets(rows: ReportScheduleTarget[]): TriggerRepository {
  return { findActiveReportTargets: async () => rows } as unknown as TriggerRepository;
}

class Clock extends AutomationClockPort {
  now(): Date {
    return new Date("2026-01-01T08:00:00Z");
  }
}
class Wake extends SchedulerWakePort {
  count = 0;
  publish(): void {
    this.count++;
  }
}
class Jobs extends ScheduledJobStorePort {
  rows: ScheduledJobRecord[] = [];
  async upsertForTarget(input: {
    projectId: string;
    targetType: string;
    targetId: string;
    cron: string;
    timezone: string;
    nextRunAt: Date;
  }): Promise<void> {
    this.rows = [
      {
        targetId: input.targetId,
        nextRunAt: input.nextRunAt,
        lastSlot: null,
        active: true,
      },
    ];
  }
  async deactivateForTarget(): Promise<void> {
    for (const row of this.rows) row.active = false;
  }
  async findAllForProject(): Promise<ScheduledJobRecord[]> {
    return this.rows;
  }
}
describe("ReportScheduleService", () => {
  it("writes the next cron slot using the injected clock and exposes paused rows without a next run", async () => {
    const jobs = new Jobs();
    const wake = new Wake();
    const service = ReportScheduleService.create({
      jobs,
      clock: new Clock(),
      wake,
      triggers: reportTargets([]),
    });
    await service.sync({
      projectId: "p",
      triggerId: "r",
      schedule: { cron: "0 9 * * *", timezone: "UTC" },
    });
    expect(jobs.rows[0]?.nextRunAt).toEqual(new Date("2026-01-01T09:00:00Z"));
    expect(wake.count).toBe(1);
    await service.remove({ projectId: "p", triggerId: "r" });
    expect(await service.getAll({ projectId: "p" })).toEqual([
      { triggerId: "r", nextRunAt: null, lastRunAt: null, active: false },
    ]);
  });
});
