import {
  reportActionParamsSchema,
  type OperatorReportSchedule,
  type ReportActionParams,
  type ReportRunOutcome,
  type ReportSchedule,
  type ReportScheduleInput,
  type Trigger,
} from "@langwatch/automation-contract";
import type { EventingCommands, PersistedProcessInstance, ProcessStore } from "@langwatch/eventing";
import { generate } from "@langwatch/ksuid";
import { Temporal, toDate } from "@langwatch/time";

import type { AutomationClock } from "../app/automation.members.ts";
import type { AutomationsPipeline } from "../eventing/automation.pipeline.ts";
import type { ReportRunSettlement } from "../eventing/report-schedule.intent.ts";
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
export class ReportScheduleService implements ReportRunSettlement {
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

  /** Each call is its own request, so the process dispatches it exactly once. */
  async requestRun(input: { projectId: string; triggerId: string }): Promise<void> {
    await this.senders().requestReportRun.send({
      ...this.envelope(input.projectId),
      triggerId: input.triggerId,
      requestId: generate("reportrun").toString(),
    });
  }

  /** Records how a run-now's dispatch ended, so the schedule accepts the next one. */
  async settleRun(input: {
    projectId: string;
    triggerId: string;
    requestId: string;
    outcome: ReportRunOutcome;
  }): Promise<void> {
    await this.senders().settleReportRun.send({
      ...this.envelope(input.projectId),
      triggerId: input.triggerId,
      requestId: input.requestId,
      outcome: input.outcome,
    });
  }

  async setActive(input: { projectId: string; triggerId: string; active: boolean }): Promise<void> {
    const target = { projectId: input.projectId, triggerId: input.triggerId };
    if (input.active) {
      await this.resume(target);
      return;
    }
    await this.remove(target);
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
      schedules.push(toReportSchedule({ triggerId: trigger.id, instance }));
    }

    return schedules;
  }

  /** Every report that is not deleted, across projects, paused ones included. */
  async findAllAcrossProjects(): Promise<OperatorReportSchedule[]> {
    const targets = await this.triggers.findAllReportTargets();
    const reportIds = new Set(targets.map((target) => target.id));
    const projectIds = [...new Set(targets.map((target) => target.projectId))];
    const schedules: OperatorReportSchedule[] = [];
    for (const projectId of projectIds) {
      const triggers = await this.triggers.findAllByProjectId({ projectId });
      for (const trigger of triggers.filter(({ id }) => reportIds.has(id))) {
        const instance = await this.findInstance({ projectId, triggerId: trigger.id });
        schedules.push(...toOperatorSchedules({ projectId, trigger, instance }));
      }
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

function toReportSchedule({
  triggerId,
  instance,
}: {
  triggerId: string;
  instance: PersistedProcessInstance<ReportScheduleState>;
}): ReportSchedule {
  const { state, nextWakeAt } = instance;
  return {
    triggerId,
    nextRunAt:
      state.active && nextWakeAt !== null
        ? toDate(Temporal.Instant.fromEpochMilliseconds(nextWakeAt))
        : null,
    lastRunAt:
      state.lastSlot === null
        ? null
        : toDate(Temporal.Instant.fromEpochMilliseconds(state.lastSlot)),
    active: state.active,
  };
}

/** A report never scheduled while paused reads its cron from the saved automation instead. */
function toOperatorSchedules({
  projectId,
  trigger,
  instance,
}: {
  projectId: string;
  trigger: Trigger;
  instance: PersistedProcessInstance<ReportScheduleState> | null;
}): OperatorReportSchedule[] {
  if (instance?.state.cron && instance.state.timezone) {
    const running = instance.state.pendingRun;
    return [
      {
        ...toReportSchedule({ triggerId: trigger.id, instance }),
        projectId,
        cron: instance.state.cron,
        timezone: instance.state.timezone,
        runningSlot: running ? toDate(Temporal.Instant.fromEpochMilliseconds(running.slot)) : null,
        createdAt: trigger.createdAt,
        updatedAt: toDate(Temporal.Instant.fromEpochMilliseconds(instance.updatedAt)),
      },
    ];
  }
  const params = ReportScheduleService.findReportActionParams(trigger.actionParams);
  if (instance || trigger.active || !params) return [];
  return [
    {
      triggerId: trigger.id,
      projectId,
      cron: params.schedule.cron,
      timezone: params.schedule.timezone,
      nextRunAt: null,
      lastRunAt: trigger.lastRunAt,
      active: false,
      runningSlot: null,
      createdAt: trigger.createdAt,
      updatedAt: trigger.updatedAt,
    },
  ];
}
