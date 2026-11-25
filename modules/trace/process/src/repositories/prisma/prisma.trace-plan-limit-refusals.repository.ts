import { prismaTables, type PrismaModelClient } from "@langwatch/prisma-client";
import { Temporal, toDate } from "@langwatch/time";

import {
  type PlanLimitRefusalDay,
  TracePlanLimitRefusalsRepository,
} from "../../features/ingestion/repositories/trace-plan-limit-refusals.repository.ts";

type PrismaTracePlanLimitRefusalsDatabase = PrismaModelClient<"TracePlanLimitRefusal">;

const dayDate = (dayStartMs: number): Date =>
  toDate(Temporal.Instant.fromEpochMilliseconds(dayStartMs));

/** Trace's plan-limit refusal counter over Postgres; every query names its project. */
export class PrismaTracePlanLimitRefusalsRepository extends TracePlanLimitRefusalsRepository {
  static readonly tables = prismaTables("TracePlanLimitRefusal");

  static create({
    prisma,
  }: {
    prisma: PrismaTracePlanLimitRefusalsDatabase;
  }): PrismaTracePlanLimitRefusalsRepository {
    return new PrismaTracePlanLimitRefusalsRepository(prisma);
  }

  private constructor(private readonly database: PrismaTracePlanLimitRefusalsDatabase) {
    super();
  }

  /** One atomic upsert: Prisma sends it as INSERT ... ON CONFLICT DO UPDATE on the key. */
  async recordRefusal({ projectId, dayStartMs }: PlanLimitRefusalDay): Promise<void> {
    const day = dayDate(dayStartMs);
    await this.database.tracePlanLimitRefusal.upsert({
      where: { projectId_day: { projectId, day } },
      create: { projectId, day, refusals: 1 },
      update: { refusals: { increment: 1 } },
    });
  }

  async countRefusals({
    projectIds,
    fromDayMs,
    toDayMs,
  }: {
    projectIds: readonly string[];
    fromDayMs: number;
    toDayMs: number;
  }): Promise<ReadonlyMap<string, number>> {
    if (projectIds.length === 0) return new Map();
    const rows = await this.database.tracePlanLimitRefusal.groupBy({
      by: ["projectId"],
      where: {
        projectId: { in: [...projectIds] },
        day: { gte: dayDate(fromDayMs), lte: dayDate(toDayMs) },
      },
      _sum: { refusals: true },
    });
    return new Map(rows.map((row) => [row.projectId, row._sum.refusals ?? 0]));
  }
}
