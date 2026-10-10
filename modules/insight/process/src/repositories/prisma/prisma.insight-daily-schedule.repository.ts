import type { InsightDailyRun } from "@langwatch/insight-contract";
import { PrismaRepository } from "@langwatch/prisma-client";

import { byNewestRun, dailyRunFromState } from "../../rules/insight-daily-schedule-row.rules.ts";
import type { InsightDailyScheduleRepository } from "../insight-daily-schedule.repository.ts";
import { dailyScheduleStateFromRow } from "./prisma.insight-daily-schedule.mapper.ts";

/** The run rows one person reads. Every query carries `projectId` and the person. */
export class PrismaInsightDailyScheduleRepository
  extends PrismaRepository.for("InsightDailyScheduleProjection")
  implements InsightDailyScheduleRepository
{
  static readonly create = this.factory(
    (prisma) => new PrismaInsightDailyScheduleRepository(prisma),
  );

  async findForUser({
    projectId,
    userId,
  }: {
    projectId: string;
    userId: string;
  }): Promise<InsightDailyRun[]> {
    const rows = await this.prisma.insightDailyScheduleProjection.findMany({
      where: { projectId, userId },
    });
    return rows
      .map((row) => dailyRunFromState({ id: row.id, state: dailyScheduleStateFromRow(row) }))
      .toSorted(byNewestRun);
  }
}
