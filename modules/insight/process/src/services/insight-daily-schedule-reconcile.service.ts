import type { ProcessStore } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";

import {
  INSIGHT_DAILY_RUN_PROCESS_NAME,
  insightDailyRunStateSchema,
} from "../eventing/insight-daily-run.process.ts";
import type { InsightDailyScheduleReconciler } from "../eventing/insight-daily-schedule-reconcile.intent.ts";
import type { InsightDailyScheduleRepository } from "../repositories/insight-daily-schedule.repository.ts";
import type { InsightOnSchedule } from "../rules/insight-daily-schedule-row.rules.ts";
import type { InsightDailyRunCommandsService } from "./insight-daily-run-commands.service.ts";

const logger = createLogger("langwatch:insight:daily-schedule-reconcile");

const PAGE_SIZE = 200;

type ScheduleInstances = Pick<ProcessStore, "findByRef">;

/**
 * Arms every schedule that is on and has no wake armed, so a deploy or a lost wake does not
 * silence it for good. It asks the schedule's own process to arm itself and changes no setting.
 */
export class InsightDailyScheduleReconcileService implements InsightDailyScheduleReconciler {
  #instances: ScheduleInstances | undefined;

  private constructor(
    private readonly schedules: Pick<InsightDailyScheduleRepository, "findOnPage">,
    private readonly commands: Pick<InsightDailyRunCommandsService, "requestScheduleRearm">,
  ) {}

  static create({
    schedules,
    commands,
  }: {
    schedules: Pick<InsightDailyScheduleRepository, "findOnPage">;
    commands: Pick<InsightDailyRunCommandsService, "requestScheduleRearm">;
  }): InsightDailyScheduleReconcileService {
    return new InsightDailyScheduleReconcileService(schedules, commands);
  }

  /** The process store of the process that hosts the pipeline, lent when it is built. */
  connect(instances: ScheduleInstances): void {
    this.#instances = instances;
  }

  /** `passAt` names the pass: carried out twice, it asks each schedule once. */
  async reconcile({ passAt }: { passAt: number }): Promise<{ repaired: number }> {
    let repaired = 0;
    let afterId: string | null = null;
    let isLastPage = false;
    while (!isLastPage) {
      const page = await this.schedules.findOnPage({ afterId, take: PAGE_SIZE });
      for (const schedule of page) {
        if (await this.isSettled(schedule)) continue;
        await this.rearm({ schedule, passAt });
        repaired += 1;
      }
      afterId = page.at(-1)?.scheduleId ?? afterId;
      isLastPage = page.length < PAGE_SIZE;
    }
    if (repaired > 0) logger.info({ repaired }, "armed daily insight schedules with no wake");
    return { repaired };
  }

  /** Whether the schedule's process needs nothing: its wake is armed, or it turned itself off. */
  private async isSettled({ projectId, scheduleId }: InsightOnSchedule): Promise<boolean> {
    if (!this.#instances) throw new Error("Daily schedule reconcile used before its pipeline");
    const instance = await this.#instances.findByRef({
      ref: { processName: INSIGHT_DAILY_RUN_PROCESS_NAME, projectId, processKey: scheduleId },
    });
    if (instance === null) return false;
    if (instance.nextWakeAt !== null) return true;
    const state = insightDailyRunStateSchema.parse(instance.state);
    // Off in the process and on in the row: the row is a fold behind, and off is the newer word.
    return state.schedule !== null && !state.active;
  }

  private async rearm({
    schedule: { scheduleId, projectId, userId, board, settings },
    passAt,
  }: {
    schedule: InsightOnSchedule;
    passAt: number;
  }): Promise<void> {
    await this.commands.requestScheduleRearm({
      tenantId: projectId,
      occurredAt: passAt,
      scheduleId,
      userId,
      board,
      ...settings,
    });
  }
}
