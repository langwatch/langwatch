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
export class ReportScheduleService {
  private constructor(
    private readonly jobs: ScheduledJobStorePort,
    private readonly clock: AutomationClockPort,
    private readonly wake: SchedulerWakePort,
  ) {}

  static create(deps: {
    jobs: ScheduledJobStorePort;
    clock: AutomationClockPort;
    wake: SchedulerWakePort;
  }): ReportScheduleService {
    return new ReportScheduleService(deps.jobs, deps.clock, deps.wake);
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
