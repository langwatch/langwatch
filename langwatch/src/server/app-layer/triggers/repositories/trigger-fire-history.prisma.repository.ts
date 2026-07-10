import type { PrismaClient } from "@prisma/client";
import type {
  TriggerFire,
  TriggerFireHistoryRepository,
  TriggerFireStats,
} from "./trigger-fire-history.repository";

export class PrismaTriggerFireHistoryRepository
  implements TriggerFireHistoryRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findAllStatsForProject({
    projectId,
    firesSince,
  }: {
    projectId: string;
    firesSince: Date;
  }): Promise<TriggerFireStats[]> {
    const [lastFired, recentCounts, openIncidents] = await Promise.all([
      this.prisma.triggerSent.groupBy({
        by: ["triggerId"],
        where: { projectId },
        _max: { createdAt: true },
      }),
      this.prisma.triggerSent.groupBy({
        by: ["triggerId"],
        where: { projectId, createdAt: { gte: firesSince } },
        _count: { _all: true },
      }),
      // Open incidents only exist for graph alerts: trace rows are dedup
      // claims that never resolve, so they must not read as "firing".
      this.prisma.triggerSent.findMany({
        where: { projectId, customGraphId: { not: null }, resolvedAt: null },
        select: { triggerId: true },
        distinct: ["triggerId"],
      }),
    ]);

    const recentCountByTriggerId = new Map(
      recentCounts.map((row) => [row.triggerId, row._count._all]),
    );
    const firingTriggerIds = new Set(openIncidents.map((r) => r.triggerId));

    return lastFired.map((row) => ({
      triggerId: row.triggerId,
      lastFiredAt: row._max.createdAt ?? null,
      recentFireCount: recentCountByTriggerId.get(row.triggerId) ?? 0,
      currentlyFiring: firingTriggerIds.has(row.triggerId),
    }));
  }

  async findAllRecentByTriggerId({
    projectId,
    triggerId,
    limit,
  }: {
    projectId: string;
    triggerId: string;
    limit: number;
  }): Promise<TriggerFire[]> {
    return this.prisma.triggerSent.findMany({
      where: { projectId, triggerId },
      orderBy: { createdAt: "desc" },
      take: limit,
      // Metadata only — no traceId and no trace content. `triggers:view`
      // must never become a side door around the trace protections surface
      // (see the note on `TriggerFire`).
      select: {
        id: true,
        triggerId: true,
        customGraphId: true,
        createdAt: true,
        resolvedAt: true,
      },
    });
  }
}
