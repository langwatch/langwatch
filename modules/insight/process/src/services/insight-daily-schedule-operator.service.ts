import type { ProcessStore } from "@langwatch/eventing";
import type { InsightOperatorDailySchedule } from "@langwatch/insight-contract";

import { INSIGHT_DAILY_RUN_PROCESS_NAME } from "../eventing/insight-daily-run.process.ts";
import type { InsightDailyScheduleRepository } from "../repositories/insight-daily-schedule.repository.ts";

/** As many schedules as one operator's list reads. */
const MAX_LISTED = 500;

type ScheduleInstances = Pick<ProcessStore, "findByRef">;

/**
 * Every person's schedule as an operator lists it: the row, and the wake its process has
 * armed. A schedule that is on with no wake armed lost it, and the hourly pass arms it again.
 */
export class InsightDailyScheduleOperatorService {
  #instances: ScheduleInstances | undefined;

  private constructor(
    private readonly schedules: Pick<InsightDailyScheduleRepository, "findDecided">,
  ) {}

  static create({
    schedules,
  }: {
    schedules: Pick<InsightDailyScheduleRepository, "findDecided">;
  }): InsightDailyScheduleOperatorService {
    return new InsightDailyScheduleOperatorService(schedules);
  }

  /** The process store of the process that hosts the pipeline, lent when it is built. */
  connect(instances: ScheduleInstances): void {
    this.#instances = instances;
  }

  async find({ limit }: { limit: number }): Promise<InsightOperatorDailySchedule[]> {
    const take = Math.min(Math.max(limit, 1), MAX_LISTED);
    const listed: InsightOperatorDailySchedule[] = [];
    for (const schedule of await this.schedules.findDecided({ take })) {
      listed.push({ ...schedule, nextRunAt: await this.nextWakeOf(schedule) });
    }
    return listed;
  }

  private async nextWakeOf({
    projectId,
    scheduleId,
  }: {
    projectId: string;
    scheduleId: string;
  }): Promise<number | null> {
    if (!this.#instances) throw new Error("Daily schedule list used before its pipeline");
    const instance = await this.#instances.findByRef({
      ref: { processName: INSIGHT_DAILY_RUN_PROCESS_NAME, projectId, processKey: scheduleId },
    });
    return instance?.nextWakeAt ?? null;
  }
}
