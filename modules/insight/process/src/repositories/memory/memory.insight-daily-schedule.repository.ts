import type { InsightDailyRun } from "@langwatch/insight-contract";

import { byNewestRun, dailyRunFromState } from "../../rules/insight-daily-schedule-row.rules.ts";
import type { InsightDailyScheduleRepository } from "../insight-daily-schedule.repository.ts";
import type { InsightMemoryStore } from "./insight-memory.store.ts";

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
}
