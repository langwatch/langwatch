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

type ReportScheduleInstances = Pick<ProcessStore, "findByRef">;
type ReportScheduleConnection = Readonly<{
  commands: EventingCommands<AutomationsPipeline>;
  instances?: ReportScheduleInstances;
}>;

/** Drives each report automation's `reportSchedule` process manager and reads its state back. */
export class ReportScheduleService {
  #commands: EventingCommands<AutomationsPipeline> | undefined;

  private constructor(
    private readonly clock: AutomationClock,
    private readonly triggers: TriggerRepository,
    private instances: ReportScheduleInstances,
  ) {}

  static create(deps: {
    clock: AutomationClock;
    triggers: TriggerRepository;
    instances: ReportScheduleInstances;
  }): ReportScheduleService {
    return new ReportScheduleService(deps.clock, deps.triggers, deps.instances);
  }

  static findReportActionParams(actionParams: unknown): ReportActionParams | null {
    const parsed = reportActionParamsSchema.safeParse(actionParams);

    return parsed.success ? parsed.data : null;
  }

  /** Binds the pipeline's senders; a process hosting the pipeline lends its process store too. */
  connect(connection: ReportScheduleConnection): void {
    this.#commands = connection.commands;
    if (connection.instances) this.instances = connection.instances;
  }

  async sync(input: {
    projectId: string;
    triggerId: string;
    schedule: ReportScheduleInput;
  }): Promise<void> {
    await this.senders().configureReportSchedule.send({
      ...this.envelope(input.projectId),
      triggerId: input.triggerId,
      cron: input.schedule.cron,
      timezone: input.schedule.timezone,
    });
  }

  async remove(input: { projectId: string; triggerId: string }): Promise<void> {
    await this.senders().pauseReportSchedule.send({
      ...this.envelope(input.projectId),
      triggerId: input.triggerId,
    });
  }

  async resume(input: { projectId: string; triggerId: string }): Promise<void> {
    await this.senders().resumeReportSchedule.send({
      ...this.envelope(input.projectId),
      triggerId: input.triggerId,
    });
  }

  async requestRun(input: {
    projectId: string;
    triggerId: string;
    requestId: string;
  }): Promise<void> {
    await this.senders().requestReportRun.send({
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
    return this.instances.findByRef<ReportScheduleState>({
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

  private senders(): EventingCommands<AutomationsPipeline> {
    if (!this.#commands) {
      throw new Error("automations registered no report schedule senders");
    }
    return this.#commands;
  }
}
