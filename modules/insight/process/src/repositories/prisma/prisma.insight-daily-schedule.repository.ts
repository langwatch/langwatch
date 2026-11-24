import type { InsightDailyRun, InsightDailyRunSetting } from "@langwatch/insight-contract";
import { type PrismaModelClient, prismaTables, skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  byNewestRun,
  dailyRunFromState,
  dailyRunSettingFromState,
  decidedScheduleFromState,
  type InsightDecidedSchedule,
  type InsightOnSchedule,
  onScheduleFromState,
} from "../../rules/insight-daily-schedule-row.rules.ts";
import {
  type InsightRunInFlightState,
  NO_RUN_STARTED,
} from "../../rules/insight-run-in-flight.rules.ts";
import type { InsightDailyScheduleRepository } from "../insight-daily-schedule.repository.ts";
import {
  dailyScheduleStateFromRow,
  type InsightDailyScheduleRow,
} from "./prisma.insight-daily-schedule.mapper.ts";
import {
  type InsightRunInFlightRow,
  runInFlightStateFromRow,
} from "./prisma.insight-run-in-flight.mapper.ts";

/** Each schedule's run in flight row by its id; a schedule with none reads `NO_RUN_STARTED`. */
function startedBySchedule(
  rows: readonly InsightRunInFlightRow[],
): (scheduleId: string) => InsightRunInFlightState {
  const byId = new Map(rows.map((row) => [row.id, runInFlightStateFromRow(row)]));
  return (scheduleId) => byId.get(scheduleId) ?? NO_RUN_STARTED;
}

/** The run rows and their run in flight rows, plus the raw SQL a read across projects needs. */
type InsightDailyScheduleDatabase = PrismaModelClient<
  "InsightDailyScheduleProjection" | "InsightRunInFlightProjection"
> &
  Pick<PrismaClient, "$queryRaw">;

/** The run rows one person reads: each of their queries carries `projectId` and the person. */
export class PrismaInsightDailyScheduleRepository implements InsightDailyScheduleRepository {
  /** Declared, not inherited: the model-scoped client carries no `$queryRaw`. */
  static readonly tables = prismaTables(
    "InsightDailyScheduleProjection",
    "InsightRunInFlightProjection",
  );

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
    if (rows.length === 0) return [];
    // Its own table, read apart: the run in flight row orders runs (ADR-004).
    const startedOf = startedBySchedule(
      await this.database.insightRunInFlightProjection.findMany({
        where: { projectId, id: { in: rows.map((row) => row.id) } },
      }),
    );
    return rows
      .map((row) =>
        dailyRunFromState({
          id: row.id,
          state: dailyScheduleStateFromRow(row),
          started: startedOf(row.id),
        }),
      )
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
    if (rows.length === 0) return [];
    // Its own table, read apart: a run in flight is folded by its own projection (ADR-004).
    const started = await this.database.insightRunInFlightProjection.findFirst({
      where: { id: scheduleId, projectId },
    });
    const startedState = started ? runInFlightStateFromRow(started) : NO_RUN_STARTED;
    return rows.map((row) =>
      dailyRunSettingFromState(dailyScheduleStateFromRow(row), startedState),
    );
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

  async findOnInProject({
    projectId,
    userId,
  }: {
    projectId: string;
    userId?: string;
  }): Promise<InsightOnSchedule[]> {
    const rows = await this.database.insightDailyScheduleProjection.findMany({
      where: { projectId, state: "on", ...(userId === undefined ? {} : { userId }) },
    });
    return rows.flatMap((row) =>
      onScheduleFromState({
        scheduleId: row.id,
        projectId: row.projectId,
        state: dailyScheduleStateFromRow(row),
      }),
    );
  }

  async findDecided({ take }: { take: number }): Promise<InsightDecidedSchedule[]> {
    const rows = await this.database.$queryRaw<InsightDailyScheduleRow[]>`
      SELECT *
      FROM "InsightDailyScheduleProjection"
      WHERE "state" IN ('on', 'off')
      ORDER BY ("state" = 'on') DESC, "id" ASC
      LIMIT ${take}
      ${skipTenantCheck({
        // The operator's list acts for no person and reads every project's schedules.
        SKIP_TENANT_CHECK: true,
      })}
    `;
    const startedOf = startedBySchedule(await this.runsInFlightOf(rows.map(({ id }) => id)));
    return rows.flatMap((row) =>
      decidedScheduleFromState({
        scheduleId: row.id,
        projectId: row.projectId,
        state: dailyScheduleStateFromRow(row),
        started: startedOf(row.id),
      }),
    );
  }

  /** The run in flight rows of schedules in any project, by their ids, for the operator's list. */
  private async runsInFlightOf(scheduleIds: string[]): Promise<InsightRunInFlightRow[]> {
    if (scheduleIds.length === 0) return [];
    return this.database.$queryRaw<InsightRunInFlightRow[]>`
      SELECT *
      FROM "InsightRunInFlightProjection"
      WHERE "id" = ANY(${scheduleIds}::text[])
      ${skipTenantCheck({
        // The operator's list acts for no person: its schedules span every project.
        SKIP_TENANT_CHECK: true,
      })}
    `;
  }
}
