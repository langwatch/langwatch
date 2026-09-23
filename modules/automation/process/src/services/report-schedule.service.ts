import {
  REPORT_SCHEDULER_TARGET_TYPE,
  reportActionParamsSchema,
  type ReportActionParams,
  type ReportSchedule,
  type ReportScheduleInput,
} from "@langwatch/automation-contract";
import { fromDate, toDate, type Instant } from "@langwatch/time";
import { Cron } from "croner";

import type { AutomationClock } from "../app/automation.members.ts";
import type { SchedulerWake } from "../channels/automation-scheduler-wake.channel.ts";
import type { AutomationScheduledJobRepository } from "../repositories/automation-scheduled-job.repository.ts";
import type { TriggerRepository } from "../repositories/trigger.repository.ts";
export class ReportScheduleService {
  private readonly jobs: AutomationScheduledJobRepository;
  private readonly clock: AutomationClock;
  private readonly wake: SchedulerWake;
  private readonly triggers: TriggerRepository;

  private constructor({
    jobs,
    clock,
    wake,
    triggers,
  }: {
    jobs: AutomationScheduledJobRepository;
    clock: AutomationClock;
    wake: SchedulerWake;
    triggers: TriggerRepository;
  }) {
    this.jobs = jobs;
    this.clock = clock;
    this.wake = wake;
    this.triggers = triggers;
  }

  static create(deps: {
    jobs: AutomationScheduledJobRepository;
    clock: AutomationClock;
    wake: SchedulerWake;
    triggers: TriggerRepository;
  }): ReportScheduleService {
    return new ReportScheduleService(deps);
  }

  static computeNextRunAt(input: { cron: string; timezone: string; after: Instant }): Instant {
    const after = toDate(input.after);
    const next = new Cron(input.cron, { timezone: input.timezone }).nextRun(after);
    if (!next) {
      throw new Error(`No report run exists after ${after.toISOString()}`);
    }

    return fromDate(next);
  }

  static findReportActionParams(actionParams: unknown): ReportActionParams | null {
    const parsed = reportActionParamsSchema.safeParse(actionParams);

    return parsed.success ? parsed.data : null;
  }

  async sync(input: {
    projectId: string;
    triggerId: string;
    schedule: ReportScheduleInput;
  }): Promise<void> {
    const nextRunAt = ReportScheduleService.computeNextRunAt({
      ...input.schedule,
      after: this.clock.now(),
    });
    await this.jobs.upsertForTarget({
      projectId: input.projectId,
      targetType: REPORT_SCHEDULER_TARGET_TYPE,
      targetId: input.triggerId,
      ...input.schedule,
      nextRunAt,
    });
    this.wake.publish();
  }

  async remove(input: { projectId: string; triggerId: string }): Promise<void> {
    await this.jobs.deactivateForTarget({
      projectId: input.projectId,
      targetType: REPORT_SCHEDULER_TARGET_TYPE,
      targetId: input.triggerId,
    });
  }

  /**
   * Create schedule row for each active report missing one using create-if-missing,
   * race-safe across workers without distributed transactions.
   */
  async reconcile(): Promise<{ repaired: number }> {
    const reports = await this.triggers.findActiveReportTargets();
    if (reports.length === 0) {
      return { repaired: 0 };
    }

    const scheduledTargetIds = new Set<string>();
    const projectIds = new Set(reports.map((report) => report.projectId));
    for (const projectId of projectIds) {
      const schedules = await this.getAll({ projectId });
      for (const schedule of schedules) {
        scheduledTargetIds.add(schedule.triggerId);
      }
    }

    let repaired = 0;
    for (const report of reports) {
      if (scheduledTargetIds.has(report.id)) {
        continue;
      }

      const parsed = ReportScheduleService.findReportActionParams(report.actionParams);
      if (!parsed) {
        continue;
      }

      await this.sync({
        projectId: report.projectId,
        triggerId: report.id,
        schedule: parsed.schedule,
      });
      repaired += 1;
    }

    return { repaired };
  }

  async getAll(input: { projectId: string }): Promise<ReportSchedule[]> {
    const rows = await this.jobs.findAllForProject({
      projectId: input.projectId,
      targetType: REPORT_SCHEDULER_TARGET_TYPE,
    });

    return rows.map((row) => ({
      triggerId: row.targetId,
      nextRunAt: row.active ? toDate(row.nextRunAt) : null,
      lastRunAt: row.lastSlot === null ? null : toDate(row.lastSlot),
      active: row.active,
    }));
  }
}
