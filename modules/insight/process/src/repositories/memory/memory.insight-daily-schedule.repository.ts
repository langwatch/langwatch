import type { InsightDailyRun, InsightDailyRunSetting } from "@langwatch/insight-contract";

import {
  byNewestRun,
  dailyRunFromState,
  dailyRunSettingFromState,
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
    const row = this.rows.schedules.get(InsightMemoryStore.scheduleKey({ projectId, scheduleId }));
    return row && row.state.userId === userId ? [dailyRunSettingFromState(row.state)] : [];
  }

  async findOnPage({
    afterId,
    take,
  }: {
    afterId: string | null;
    take: number;
  }): Promise<InsightOnSchedule[]> {
    return [...this.rows.schedules.entries()]
      .flatMap(([key, row]) => {
        const at = key.lastIndexOf(":");
        return onScheduleFromState({
          scheduleId: key.slice(at + 1),
          projectId: key.slice(0, at),
          state: row.state,
        });
      })
      .filter(({ scheduleId }) => afterId === null || scheduleId > afterId)
      .toSorted((a, b) => (a.scheduleId < b.scheduleId ? -1 : 1))
      .slice(0, take);
  }
}
