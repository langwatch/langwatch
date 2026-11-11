// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { PrismaRepository } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { NurturingTraceDay } from "../../rules/nurturing-trace-day.rules.ts";
import type { NurturingTraceDayRepository } from "../nurturing-trace-day.repository.ts";

type NurturingTraceDayDatabase = Pick<PrismaClient, "nurturingProjectTraceDay" | "$executeRaw">;

const dateOf = (at: number | null) => (at === null ? null : new Date(at));

/**
 * Nurturing's trace counts in Postgres (`NurturingProjectTraceDay`): one row per project and UTC
 * day with native counts, incremented in place.
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

  /** One upsert per day: concurrent writers add to the row, so no count is lost between them. */
  async addTraceDays(increments: readonly NurturingTraceDay[]): Promise<void> {
    for (const {
      projectId,
      day,
      traceCount,
      errorCount,
      lastTraceAt,
      lastFailedTraceAt,
    } of increments) {
      await this.#database.$executeRaw`
        INSERT INTO "NurturingProjectTraceDay" AS counted
          ("projectId", "day", "traceCount", "errorCount", "lastTraceAt", "lastFailedTraceAt")
        VALUES (${projectId}, ${day}, ${traceCount}::integer, ${errorCount}::integer,
                ${dateOf(lastTraceAt)}::timestamp(3), ${dateOf(lastFailedTraceAt)}::timestamp(3))
        ON CONFLICT ("projectId", "day") DO UPDATE SET
          "traceCount" = counted."traceCount" + EXCLUDED."traceCount",
          "errorCount" = counted."errorCount" + EXCLUDED."errorCount",
          "lastTraceAt" = GREATEST(counted."lastTraceAt", EXCLUDED."lastTraceAt"),
          "lastFailedTraceAt" = GREATEST(counted."lastFailedTraceAt", EXCLUDED."lastFailedTraceAt")
      `;
    }
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
    await this.#database.nurturingProjectTraceDay.deleteMany({
      where: { projectId: { in: [...projectIds] }, day: { lt: beforeDay } },
    });
  }
}
