import { describe, expect, it } from "vitest";
import { AutomationClock } from "../../app/automation.members.ts";
import { AutomationScheduledJobRepository, type ScheduledJobRecord } from "../../repositories/automation-scheduled-job.repository.ts";
import { SchedulerWake } from "../../channels/automation-scheduler-wake.channel.ts";
import type {
  ReportScheduleTarget,
  TriggerRepository,
} from "../../repositories/trigger.repository.ts";
import { ReportScheduleService } from "../report-schedule.service.ts";
import { type Instant, Temporal } from "@langwatch/time";

/** Only the one read the reconcile sweep makes; the rest is not this test's subject. */
function reportTargets(rows: ReportScheduleTarget[]): TriggerRepository {
  return { findActiveReportTargets: async () => rows } as unknown as TriggerRepository;
}

class Clock implements AutomationClock {
  now(): Instant {
    return Temporal.Instant.from("2026-01-01T08:00:00Z");
  }
}
class Wake extends SchedulerWake {
  count = 0;
  publish(): void {
    this.count++;
  }
}
class Jobs extends AutomationScheduledJobRepository {
  rows: ScheduledJobRecord[] = [];
  async upsertForTarget(input: {
    projectId: string;
    targetType: string;
    targetId: string;
    cron: string;
    timezone: string;
    nextRunAt: Instant;
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
    expect(jobs.rows[0]?.nextRunAt).toEqual(Temporal.Instant.from("2026-01-01T09:00:00Z"));
    expect(wake.count).toBe(1);
    await service.remove({ projectId: "p", triggerId: "r" });
    expect(await service.getAll({ projectId: "p" })).toEqual([
      { triggerId: "r", nextRunAt: null, lastRunAt: null, active: false },
    ]);
  });
});
