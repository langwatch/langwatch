import {
  reportActionParamsSchema,
  type ReportActionParams,
  type ReportSchedule,
  type ReportScheduleInput,
} from "@langwatch/automation-contract";
import type { EventingCommands, ProcessStore } from "@langwatch/eventing";
import { Temporal, toDate } from "@langwatch/time";

import type { AutomationClock } from "../app/automation.members.ts";
import type { AutomationsPipeline } from "../eventing/automation.pipeline.ts";
import {
  REPORT_SCHEDULE_PROCESS_NAME,
  type ReportScheduleState,
} from "../eventing/report-schedule.process.ts";
import type { TriggerRepository } from "../repositories/trigger.repository.ts";

type ReportScheduleConnection = Readonly<{
  commands: EventingCommands<AutomationsPipeline>;
  instances: Pick<ProcessStore, "findByRef">;
}>;

/** Drives each report automation's `reportSchedule` process manager and reads its state back. */
export class ReportScheduleService {
  #connection: ReportScheduleConnection | undefined;

  private constructor(
    private readonly clock: AutomationClock,
    private readonly triggers: TriggerRepository,
  ) {}

  static create(deps: {
    clock: AutomationClock;
    triggers: TriggerRepository;
  }): ReportScheduleService {
    return new ReportScheduleService(deps.clock, deps.triggers);
  }

  static findReportActionParams(actionParams: unknown): ReportActionParams | null {
    const parsed = reportActionParamsSchema.safeParse(actionParams);

    return parsed.success ? parsed.data : null;
  }

  /** Binds the registered `automations` pipeline's senders and its process store. Called once. */
  connect(connection: ReportScheduleConnection): void {
    this.#connection = connection;
  }

  async sync(input: {
    projectId: string;
    triggerId: string;
    schedule: ReportScheduleInput;
  }): Promise<void> {
    await this.connected().commands.configureReportSchedule.send({
      ...this.envelope(input.projectId),
      triggerId: input.triggerId,
      cron: input.schedule.cron,
      timezone: input.schedule.timezone,
    });
  }

  async remove(input: { projectId: string; triggerId: string }): Promise<void> {
    await this.connected().commands.pauseReportSchedule.send({
      ...this.envelope(input.projectId),
      triggerId: input.triggerId,
    });
  }

  async resume(input: { projectId: string; triggerId: string }): Promise<void> {
    await this.connected().commands.resumeReportSchedule.send({
      ...this.envelope(input.projectId),
      triggerId: input.triggerId,
    });
  }

  async requestRun(input: {
    projectId: string;
    triggerId: string;
    requestId: string;
  }): Promise<void> {
    await this.connected().commands.requestReportRun.send({
      ...this.envelope(input.projectId),
      triggerId: input.triggerId,
      requestId: input.requestId,
    });
  }

  /** Configures every active report with no process instance yet; a paused one keeps its pause. */
  async reconcile(): Promise<{ repaired: number }> {
    const reports = await this.triggers.findActiveReportTargets();
    let repaired = 0;
    for (const report of reports) {
      const parsed = ReportScheduleService.findReportActionParams(report.actionParams);
      if (!parsed) continue;
      const instance = await this.findInstance({
        projectId: report.projectId,
        triggerId: report.id,
      });
      if (instance) continue;
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
    const triggers = await this.triggers.findAllByProjectId(input);
    const schedules: ReportSchedule[] = [];
    for (const trigger of triggers) {
      if (!ReportScheduleService.findReportActionParams(trigger.actionParams)) continue;
      const instance = await this.findInstance({
        projectId: input.projectId,
        triggerId: trigger.id,
      });
      if (!instance) continue;
      const { state, nextWakeAt } = instance;
      schedules.push({
        triggerId: trigger.id,
        nextRunAt:
          state.active && nextWakeAt !== null
            ? toDate(Temporal.Instant.fromEpochMilliseconds(nextWakeAt))
            : null,
        lastRunAt:
          state.lastSlot === null
            ? null
            : toDate(Temporal.Instant.fromEpochMilliseconds(state.lastSlot)),
        active: state.active,
      });
    }

    return schedules;
  }

  private findInstance(input: { projectId: string; triggerId: string }) {
    return this.connected().instances.findByRef<ReportScheduleState>({
      ref: {
        processName: REPORT_SCHEDULE_PROCESS_NAME,
        projectId: input.projectId,
        processKey: input.triggerId,
      },
    });
  }

  private envelope(projectId: string): { tenantId: string; occurredAt: number } {
    return { tenantId: projectId, occurredAt: this.clock.now().epochMilliseconds };
  }

  private connected(): ReportScheduleConnection {
    if (!this.#connection) {
      throw new Error(
        "automations registered no report schedule senders; this process hosts no automations pipeline",
      );
    }
    return this.#connection;
  }
}
