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
  "nurturingProjectTraceDay" | "$executeRaw"
>;

/**
 * Nurturing's trace counts in Postgres: one `NurturingProjectTraceDay` row per project and UTC
 * day with native counts, incremented in place by each batch.
 */
export class PrismaNurturingTraceDayRepository
  extends PrismaRepository.for("NurturingProjectTraceDay")
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
   * One statement per batch: the batch's traces are counted per project and day, and added to the
   * day row. Concurrent writers add to a day row, so no count is lost between them. Nothing
   * de-duplicates: a redelivered batch counts again (accepted, owner decision, issue 9378).
   */
  async countTraces(traces: readonly NurturingCountedTrace[]): Promise<void> {
    if (traces.length === 0) return;
    await this.#database.$executeRaw`
      INSERT INTO "NurturingProjectTraceDay" AS counted
        ("projectId", "day", "traceCount", "errorCount", "lastTraceAt", "lastFailedTraceAt")
      SELECT incoming."projectId", incoming."day",
             (count(*) FILTER (WHERE incoming."kind" = 'trace'))::integer,
             (count(*) FILTER (WHERE incoming."kind" = 'failed'))::integer,
             max((to_timestamp(incoming."at" / 1000.0) AT TIME ZONE 'UTC')::timestamp(3))
               FILTER (WHERE incoming."kind" = 'trace'),
             max((to_timestamp(incoming."at" / 1000.0) AT TIME ZONE 'UTC')::timestamp(3))
               FILTER (WHERE incoming."kind" = 'failed')
      FROM unnest(
        ${traces.map(({ projectId }) => projectId)}::text[],
        ${traces.map(({ kind }) => kind)}::text[],
        ${traces.map(({ day }) => day)}::text[],
        ${traces.map(({ at }) => at)}::double precision[]
      ) AS incoming("projectId", "kind", "day", "at")
      GROUP BY incoming."projectId", incoming."day"
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
    await this.#database.nurturingProjectTraceDay.deleteMany({ where });
  }

  async pruneProjects({ projectIds }: Readonly<{ projectIds: readonly string[] }>): Promise<void> {
    if (projectIds.length === 0) return;
    const where = { projectId: { in: [...projectIds] } };
    await this.#database.nurturingProjectTraceDay.deleteMany({ where });
  }
}
