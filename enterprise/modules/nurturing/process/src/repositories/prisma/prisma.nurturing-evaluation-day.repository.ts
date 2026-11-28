// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { PrismaRepository } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  NurturingEvaluationDay,
  NurturingEvaluationDayRepository,
} from "../nurturing-evaluation-day.repository.ts";

type NurturingEvaluationDayDatabase = Pick<PrismaClient, "nurturingProjectEvaluationDay">;

/** Nurturing's evaluation days in Postgres: one `NurturingProjectEvaluationDay` row per day. */
export class PrismaNurturingEvaluationDayRepository
  extends PrismaRepository.for("NurturingProjectEvaluationDay")
  implements NurturingEvaluationDayRepository
{
  static create({
    prisma,
  }: Readonly<{ prisma: NurturingEvaluationDayDatabase }>): PrismaNurturingEvaluationDayRepository {
    return new PrismaNurturingEvaluationDayRepository(prisma);
  }

  readonly #database: NurturingEvaluationDayDatabase;

  private constructor(prisma: NurturingEvaluationDayDatabase) {
    super(prisma);
    this.#database = prisma;
  }

  recordDay(day: NurturingEvaluationDay): Promise<void> {
    return this.recordDays([day]);
  }

  /** ON CONFLICT DO NOTHING: a known day, or one written concurrently, raises no P2002. */
  async recordDays(days: readonly NurturingEvaluationDay[]): Promise<void> {
    if (days.length === 0) return;
    await this.#database.nurturingProjectEvaluationDay.createMany({
      data: days.map(({ projectId, day }) => ({ projectId, day })),
      skipDuplicates: true,
    });
  }

  async findForProjects({
    projectIds,
    afterDay,
  }: Readonly<{
    projectIds: readonly string[];
    afterDay: string;
  }>): Promise<NurturingEvaluationDay[]> {
    if (projectIds.length === 0) return [];
    return this.#database.nurturingProjectEvaluationDay.findMany({
      where: { projectId: { in: [...projectIds] }, day: { gt: afterDay } },
      select: { projectId: true, day: true },
    });
  }

  async pruneProjects({ projectIds }: Readonly<{ projectIds: readonly string[] }>): Promise<void> {
    if (projectIds.length === 0) return;
    await this.#database.nurturingProjectEvaluationDay.deleteMany({
      where: { projectId: { in: [...projectIds] } },
    });
  }
}
