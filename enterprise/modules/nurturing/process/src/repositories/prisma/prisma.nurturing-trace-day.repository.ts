// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { PrismaRepository } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  NurturingCountedTrace,
  NurturingTraceDay,
} from "../../rules/nurturing-trace-day.rules.ts";
import type { NurturingTraceDayRepository } from "../nurturing-trace-day.repository.ts";

type NurturingTraceDayDatabase = Pick<
  PrismaClient,
  "nurturingProjectTraceDay" | "nurturingProjectCountedTrace" | "$executeRaw"
>;

/**
 * Nurturing's trace counts in Postgres: one `NurturingProjectTraceDay` row per project and UTC
 * day with native counts, incremented in place by the traces `NurturingProjectCountedTrace` had
 * not yet counted.
 */
export class PrismaNurturingTraceDayRepository
  extends PrismaRepository.for("NurturingProjectTraceDay", "NurturingProjectCountedTrace")
  implements NurturingTraceDayRepository
{
  static create({
    prisma,
  }: Readonly<{ prisma: NurturingTraceDayDatabase }>): PrismaNurturingTraceDayRepository {
    return new PrismaNurturingTraceDayRepository(prisma);
  }

  readonly #database: NurturingTraceDayDatabase;

  private constructor(prisma: NurturingTraceDayDatabase) {
    super(prisma);
    this.#database = prisma;
  }

  /**
   * One statement per batch: the traces not yet counted are inserted (a conflict is one already
   * counted, or a duplicate in the batch), and only the inserted rows are added to their days.
   * Concurrent writers add to a day row, so no count is lost between them.
   */
  async countTraces(traces: readonly NurturingCountedTrace[]): Promise<void> {
    if (traces.length === 0) return;
    await this.#database.$executeRaw`
      WITH fresh AS (
        INSERT INTO "NurturingProjectCountedTrace"
          ("projectId", "traceId", "kind", "day", "appendedAt")
        SELECT incoming."projectId", incoming."traceId", incoming."kind", incoming."day",
               (to_timestamp(incoming."at" / 1000.0) AT TIME ZONE 'UTC')::timestamp(3)
        FROM unnest(
          ${traces.map(({ projectId }) => projectId)}::text[],
          ${traces.map(({ traceId }) => traceId)}::text[],
          ${traces.map(({ kind }) => kind)}::text[],
          ${traces.map(({ day }) => day)}::text[],
          ${traces.map(({ at }) => at)}::double precision[]
        ) AS incoming("projectId", "traceId", "kind", "day", "at")
        WHERE incoming."projectId" = ANY(${[...new Set(traces.map(({ projectId }) => projectId))]}::text[])
        ON CONFLICT ("projectId", "traceId", "kind") DO NOTHING
        RETURNING "projectId", "kind", "day", "appendedAt"
      )
      INSERT INTO "NurturingProjectTraceDay" AS counted
        ("projectId", "day", "traceCount", "errorCount", "lastTraceAt", "lastFailedTraceAt")
      SELECT "projectId", "day",
             (count(*) FILTER (WHERE "kind" = 'trace'))::integer,
             (count(*) FILTER (WHERE "kind" = 'failed'))::integer,
             max("appendedAt") FILTER (WHERE "kind" = 'trace'),
             max("appendedAt") FILTER (WHERE "kind" = 'failed')
      FROM fresh
      GROUP BY "projectId", "day"
      ON CONFLICT ("projectId", "day") DO UPDATE SET
        "traceCount" = counted."traceCount" + EXCLUDED."traceCount",
        "errorCount" = counted."errorCount" + EXCLUDED."errorCount",
        "lastTraceAt" = GREATEST(counted."lastTraceAt", EXCLUDED."lastTraceAt"),
        "lastFailedTraceAt" = GREATEST(counted."lastFailedTraceAt", EXCLUDED."lastFailedTraceAt")
    `;
  }

  async findForProjects({
    projectIds,
    afterDay,
  }: Readonly<{ projectIds: readonly string[]; afterDay: string }>): Promise<NurturingTraceDay[]> {
    if (projectIds.length === 0) return [];
    const rows = await this.#database.nurturingProjectTraceDay.findMany({
      where: { projectId: { in: [...projectIds] }, day: { gt: afterDay } },
    });
    return rows.map((row) => ({
      projectId: row.projectId,
      day: row.day,
      traceCount: row.traceCount,
      errorCount: row.errorCount,
      lastTraceAt: row.lastTraceAt?.getTime() ?? null,
      lastFailedTraceAt: row.lastFailedTraceAt?.getTime() ?? null,
    }));
  }

  async pruneBefore({
    projectIds,
    beforeDay,
  }: Readonly<{ projectIds: readonly string[]; beforeDay: string }>): Promise<void> {
    if (projectIds.length === 0) return;
    const where = { projectId: { in: [...projectIds] }, day: { lt: beforeDay } };
    await this.#database.nurturingProjectCountedTrace.deleteMany({ where });
    await this.#database.nurturingProjectTraceDay.deleteMany({ where });
  }

  async pruneProjects({ projectIds }: Readonly<{ projectIds: readonly string[] }>): Promise<void> {
    if (projectIds.length === 0) return;
    const where = { projectId: { in: [...projectIds] } };
    await this.#database.nurturingProjectCountedTrace.deleteMany({ where });
    await this.#database.nurturingProjectTraceDay.deleteMany({ where });
  }
}
