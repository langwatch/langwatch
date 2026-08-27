import type { TriggerFire, TriggerFireStats } from "@langwatch/automation-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { TriggerFireHistoryRepository } from "../trigger-fire-history.repository";
const mapFire = (row: unknown): TriggerFire => {
  const value = row as Record<string, unknown>;
  return {
    id: String(value.id),
    triggerId: String(value.triggerId),
    customGraphId: typeof value.customGraphId === "string" ? value.customGraphId : null,
    createdAt: value.createdAt as Date,
    resolvedAt: value.resolvedAt instanceof Date ? value.resolvedAt : null,
  };
};
export class PrismaTriggerFireHistoryRepository extends TriggerFireHistoryRepository {
  private constructor(private readonly database: PrismaClient) {
    super();
  }
  static create(database: object): PrismaTriggerFireHistoryRepository {
    return new PrismaTriggerFireHistoryRepository(database as PrismaClient);
  }
  async create(input: {
    projectId: string;
    triggerId: string;
    traceId: string | null;
    customGraphId: string | null;
    createdAt: Date;
    resolvedAt: Date | null;
  }): Promise<TriggerFire> {
    const row = await this.database.triggerSent.create({ data: input });
    return mapFire(row);
  }
  async findAllStatsForProject(input: {
    projectId: string;
    firesSince: Date;
  }): Promise<TriggerFireStats[]> {
    const [lastFired, recentCounts, openIncidents] = await Promise.all([
      this.database.triggerSent.groupBy({
        by: ["triggerId"],
        where: { projectId: input.projectId },
        orderBy: { triggerId: "asc" },
        _max: { createdAt: true },
      }),
      this.database.triggerSent.groupBy({
        by: ["triggerId"],
        where: {
          projectId: input.projectId,
          createdAt: { gte: input.firesSince },
        },
        orderBy: { triggerId: "asc" },
        _count: { _all: true },
      }),
      this.database.triggerSent.findMany({
        where: {
          projectId: input.projectId,
          customGraphId: { not: null },
          resolvedAt: null,
        },
        select: { triggerId: true },
        distinct: ["triggerId"],
      }),
    ]);
    const recentCountByTriggerId = new Map(
      recentCounts.map((row: unknown) => {
        const value = row as {
          triggerId: string;
          _count: { _all: number };
        };
        return [value.triggerId, value._count._all] as const;
      }),
    );
    const firingTriggerIds = new Set(
      openIncidents.map((row: unknown) => (row as { triggerId: string }).triggerId),
    );
    return lastFired.map((row: unknown) => {
      const value = row as {
        triggerId: string;
        _max: { createdAt: Date | null };
      };
      return {
        triggerId: value.triggerId,
        lastFiredAt: value._max.createdAt,
        recentFireCount: recentCountByTriggerId.get(value.triggerId) ?? 0,
        currentlyFiring: firingTriggerIds.has(value.triggerId),
      };
    });
  }
  async findAllRecentByTriggerId(input: {
    projectId: string;
    triggerId: string;
    limit: number;
  }): Promise<TriggerFire[]> {
    const rows = await this.database.triggerSent.findMany({
      where: { projectId: input.projectId, triggerId: input.triggerId },
      orderBy: { createdAt: "desc" },
      take: input.limit,
    });
    return rows.map(mapFire);
  }
  async findAllRecentForProject(input: {
    projectId: string;
    limit: number;
  }): Promise<TriggerFire[]> {
    const rows = await this.database.triggerSent.findMany({
      where: { projectId: input.projectId },
      orderBy: { createdAt: "desc" },
      take: input.limit,
    });
    return rows.map(mapFire);
  }
  findStats(input: {
    projectId: string;
    firesSince: Date;
  }): Promise<import("@langwatch/automation-contract").AutomationFireStats[]> {
    return this.findAllStatsForProject(input).then((rows) =>
      rows.map(({ currentlyFiring: _current, ...row }) => row),
    );
  }
  findRecent(input: {
    projectId: string;
    triggerId?: string;
    limit: number;
  }): Promise<TriggerFire[]> {
    return input.triggerId
      ? this.findAllRecentByTriggerId(
          input as { projectId: string; triggerId: string; limit: number },
        )
      : this.findAllRecentForProject(input);
  }
}
