import { Cron } from "croner";
import {
  REPORT_SCHEDULER_TARGET_TYPE,
  reportActionParamsSchema,
  type ReportActionParams,
  type ReportScheduleInput,
} from "@langwatch/automation-contract";
import { AutomationClockPort } from "../ports/automation-clock.port";
import { ScheduledJobStorePort } from "../ports/scheduled-jobs.port";
import { SchedulerWakePort } from "../ports/scheduler-wake.port";
import type { TriggerRepository } from "../repositories/trigger.repository";
export class ReportScheduleService {
  private constructor(
    private readonly jobs: ScheduledJobStorePort,
    private readonly clock: AutomationClockPort,
    private readonly wake: SchedulerWakePort,
    private readonly triggers: TriggerRepository,
  ) {}

  static create(deps: {
    jobs: ScheduledJobStorePort;
    clock: AutomationClockPort;
    wake: SchedulerWakePort;
    triggers: TriggerRepository;
  }): ReportScheduleService {
    return new ReportScheduleService(deps.jobs, deps.clock, deps.wake, deps.triggers);
  }

  static computeNextRunAt(input: { cron: string; timezone: string; after: Date }): Date {
    const next = new Cron(input.cron, { timezone: input.timezone }).nextRun(input.after);
    if (!next) {
      throw new Error(`No report run exists after ${input.after.toISOString()}`);
    }

    return next;
  }

  static tryExtract(actionParams: unknown): ReportActionParams | null {
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
   * Create the schedule row of every active report that has none.
   *
   * A report's `Trigger` row and its `ScheduledJob` are two writes, and a
   * process that made the first and not the second leaves an active report
   * that never comes due — silence a customer reads as "the report is
   * running". Repairing at boot is what closes that window without a
   * distributed transaction: the sweep is create-if-missing and therefore
   * race-safe across every worker that runs it.
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

      const parsed = ReportScheduleService.tryExtract(report.actionParams);
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

  async getAll(input: { projectId: string }): Promise<
    Array<{
      triggerId: string;
      nextRunAt: Date | null;
      lastRunAt: Date | null;
      active: boolean;
    }>
  > {
    const rows = await this.jobs.findAllForProject({
      projectId: input.projectId,
      targetType: REPORT_SCHEDULER_TARGET_TYPE,
    });

    return rows.map((row) => ({
      triggerId: row.targetId,
      nextRunAt: row.active ? row.nextRunAt : null,
      lastRunAt: row.lastSlot,
      active: row.active,
    }));
  }
}
