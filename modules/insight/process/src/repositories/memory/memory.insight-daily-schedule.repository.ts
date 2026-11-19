import type { InsightDailyRun, InsightDailyRunSetting } from "@langwatch/insight-contract";

import { NO_RUN_STARTED } from "../../eventing/insight-run-in-flight.projection.ts";
import {
  byNewestRun,
  byOnThenId,
  dailyRunFromState,
  dailyRunSettingFromState,
  decidedScheduleFromState,
  type InsightDecidedSchedule,
  type InsightOnSchedule,
  onScheduleFromState,
} from "../../rules/insight-daily-schedule-row.rules.ts";
import type { InsightDailyScheduleRepository } from "../insight-daily-schedule.repository.ts";
import { InsightMemoryStore } from "./insight-memory.store.ts";

/** The memory twin of `PrismaInsightDailyScheduleRepository`, over the same folded rows. */
export class MemoryInsightDailyScheduleRepository implements InsightDailyScheduleRepository {
  private constructor(private readonly rows: InsightMemoryStore) {}

  static create({ rows }: { rows: InsightMemoryStore }): MemoryInsightDailyScheduleRepository {
    return new MemoryInsightDailyScheduleRepository(rows);
  }

  async findForUser({
    projectId,
    userId,
  }: {
    projectId: string;
    userId: string;
  }): Promise<InsightDailyRun[]> {
    const prefix = `${projectId}:`;
    return [...this.rows.schedules.entries()]
      .filter(([key, row]) => key.startsWith(prefix) && row.state.userId === userId)
      .map(([key, row]) => dailyRunFromState({ id: key.slice(prefix.length), state: row.state }))
      .toSorted(byNewestRun);
  }

  async findSetting({
    projectId,
    userId,
    scheduleId,
  }: {
    projectId: string;
    userId: string;
    scheduleId: string;
  }): Promise<InsightDailyRunSetting[]> {
    const key = InsightMemoryStore.scheduleKey({ projectId, scheduleId });
    const row = this.rows.schedules.get(key);
    if (!row || row.state.userId !== userId) return [];
    const started = this.rows.runsInFlight.get(key)?.state ?? NO_RUN_STARTED;
    return [dailyRunSettingFromState(row.state, started)];
  }

  async findOnPage({
    afterId,
    take,
  }: {
    afterId: string | null;
    take: number;
  }): Promise<InsightOnSchedule[]> {
    return this.everyRow()
      .flatMap((row) => onScheduleFromState(row))
      .filter(({ scheduleId }) => afterId === null || scheduleId > afterId)
      .toSorted((a, b) => (a.scheduleId < b.scheduleId ? -1 : 1))
      .slice(0, take);
  }

  async findOnInProject({
    projectId,
    userId,
  }: {
    projectId: string;
    userId?: string;
  }): Promise<InsightOnSchedule[]> {
    return this.everyRow()
      .flatMap((row) => onScheduleFromState(row))
      .filter((schedule) => schedule.projectId === projectId)
      .filter((schedule) => userId === undefined || schedule.userId === userId);
  }

  async findDecided({ take }: { take: number }): Promise<InsightDecidedSchedule[]> {
    return this.everyRow()
      .flatMap((row) => decidedScheduleFromState(row))
      .toSorted(byOnThenId)
      .slice(0, take);
  }

  /** Every row with the project and the schedule its key names. */
  private everyRow() {
    return [...this.rows.schedules.entries()].map(([key, row]) => {
      const at = key.lastIndexOf(":");
      return { scheduleId: key.slice(at + 1), projectId: key.slice(0, at), state: row.state };
    });
  }
}
