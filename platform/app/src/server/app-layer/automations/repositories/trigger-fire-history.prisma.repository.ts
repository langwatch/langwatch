import type { PrismaClient } from "~/generated/prisma/client";
import type {
  TriggerFire,
  TriggerFireCursor,
  TriggerFireHistoryRepository,
  TriggerFirePage,
  TriggerFireStats,
} from "./trigger-fire-history.repository";

/** Metadata-only projection for every fire ROW this repository returns — no
 *  traceId and no trace content (see `TriggerFire`). The stats reads
 *  aggregate with `groupBy`/`_count` and project no row fields at all. */
const FIRE_FIELDS = {
  id: true,
  triggerId: true,
  customGraphId: true,
  createdAt: true,
  resolvedAt: true,
} as const;

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

  async findPageByTriggerId({
    projectId,
    triggerId,
    limit,
    cursor,
  }: {
    projectId: string;
    triggerId: string;
    limit: number;
    cursor: TriggerFireCursor | null;
  }): Promise<TriggerFirePage> {
    const rows = await this.prisma.triggerSent.findMany({
      where: {
        projectId,
        triggerId,
        // Keyset pagination on (createdAt desc, id desc). `createdAt` alone
        // is not unique — a burst of matches shares a millisecond — so the
        // tie is broken on the row id, or a page boundary landing inside a
        // burst would skip rows.
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      // One extra row answers "is there more?" without a second count query.
      take: limit + 1,
      select: FIRE_FIELDS,
    });

    const fires = rows.slice(0, limit);
    const last = fires[fires.length - 1];
    return {
      fires,
      nextCursor:
        rows.length > limit && last
          ? { createdAt: last.createdAt, id: last.id }
          : null,
    };
  }

  async findAllRecentForProject({
    projectId,
    limit,
  }: {
    projectId: string;
    limit: number;
  }): Promise<TriggerFire[]> {
    return this.prisma.triggerSent.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: limit,
      // Same metadata-only contract as the per-trigger read: widening the
      // scope to the whole project must not widen what a fire reveals.
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
