import type { InsightDailyRun, InsightDailyRunSetting } from "@langwatch/insight-contract";
import { type PrismaModelClient, prismaTables, skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  byNewestRun,
  dailyRunFromState,
  dailyRunSettingFromState,
  type InsightOnSchedule,
  onScheduleFromState,
} from "../../rules/insight-daily-schedule-row.rules.ts";
import type { InsightDailyScheduleRepository } from "../insight-daily-schedule.repository.ts";
import {
  dailyScheduleStateFromRow,
  type InsightDailyScheduleRow,
} from "./prisma.insight-daily-schedule.mapper.ts";

/** The run rows, plus the raw SQL the reconcile pass needs to read across projects. */
type InsightDailyScheduleDatabase = PrismaModelClient<"InsightDailyScheduleProjection"> &
  Pick<PrismaClient, "$queryRaw">;

/** The run rows one person reads: each of their queries carries `projectId` and the person. */
export class PrismaInsightDailyScheduleRepository implements InsightDailyScheduleRepository {
  /** Declared, not inherited: the model-scoped client carries no `$queryRaw`. */
  static readonly tables = prismaTables("InsightDailyScheduleProjection");

  static create({
    prisma,
  }: {
    prisma: InsightDailyScheduleDatabase;
  }): PrismaInsightDailyScheduleRepository {
    return new PrismaInsightDailyScheduleRepository(prisma);
  }

  private constructor(private readonly database: InsightDailyScheduleDatabase) {}

  async findForUser({
    projectId,
    userId,
  }: {
    projectId: string;
    userId: string;
  }): Promise<InsightDailyRun[]> {
    const rows = await this.database.insightDailyScheduleProjection.findMany({
      where: { projectId, userId },
    });
    return rows
      .map((row) => dailyRunFromState({ id: row.id, state: dailyScheduleStateFromRow(row) }))
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
    const rows = await this.database.insightDailyScheduleProjection.findMany({
      where: { id: scheduleId, projectId, userId },
    });
    return rows.map((row) => dailyRunSettingFromState(dailyScheduleStateFromRow(row)));
  }

  async findOnPage({
    afterId,
    take,
  }: {
    afterId: string | null;
    take: number;
  }): Promise<InsightOnSchedule[]> {
    const rows = await this.database.$queryRaw<InsightDailyScheduleRow[]>`
      SELECT *
      FROM "InsightDailyScheduleProjection"
      WHERE "state" = 'on'
        AND "id" > ${afterId ?? ""}
      ORDER BY "id" ASC
      LIMIT ${take}
      ${skipTenantCheck({
        // The reconcile pass acts for no person and reads every project's schedules that are on.
        SKIP_TENANT_CHECK: true,
      })}
    `;
    return rows.flatMap((row) =>
      onScheduleFromState({
        scheduleId: row.id,
        projectId: row.projectId,
        state: dailyScheduleStateFromRow(row),
      }),
    );
  }
}
