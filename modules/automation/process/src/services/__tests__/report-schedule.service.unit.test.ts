import { type Instant, Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { AutomationClock } from "../../app/automation.members.ts";
import { SchedulerWake } from "../../channels/automation-scheduler-wake.channel.ts";
import {
  AutomationScheduledJobRepository,
  type ScheduledJobRecord,
} from "../../repositories/automation-scheduled-job.repository.ts";
import type {
  ReportScheduleTarget,
  TriggerRepository,
} from "../../repositories/trigger.repository.ts";
import { ReportScheduleService } from "../report-schedule.service.ts";

/** Only the one read the reconcile sweep makes; the rest is not this test's subject. */
function reportTargets(rows: ReportScheduleTarget[]): TriggerRepository {
  const unused = (member: string) => () => {
    throw new Error(`the reconcile sweep never calls TriggerRepository.${member}`);
  };
  return {
    findActiveReportTargets: async () => rows,
    findActiveForProject: unused("findActiveForProject"),
    countUsage: unused("countUsage"),
    claimSend: unused("claimSend"),
    isSendClaimed: unused("isSendClaimed"),
    findClaimedTraceIds: unused("findClaimedTraceIds"),
    updateLastRunAt: unused("updateLastRunAt"),
    findByIdOrThrow: unused("findByIdOrThrow"),
    findById: unused("findById"),
    findAllByProjectId: unused("findAllByProjectId"),
    findByCustomGraphId: unused("findByCustomGraphId"),
    findByCustomGraphIds: unused("findByCustomGraphIds"),
    create: unused("create"),
    update: unused("update"),
  };
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
