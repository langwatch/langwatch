import type {
  AutomationApiFireHistoryInput,
  TriggerFire,
  TriggerFirePage,
  TriggerFireStats,
} from "@langwatch/automation-contract";
import type * as automationContractModule from "@langwatch/automation-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { toDate, type Instant } from "@langwatch/time";

import { TriggerFireHistoryRepository } from "../trigger-fire-history.repository.ts";
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
/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
type TriggerFireHistoryDatabase = Pick<PrismaClient, "triggerSent">;

export class PrismaTriggerFireHistoryRepository extends TriggerFireHistoryRepository {
  private constructor(private readonly database: TriggerFireHistoryDatabase) {
    super();
  }
  static create(database: TriggerFireHistoryDatabase): PrismaTriggerFireHistoryRepository {
    return new PrismaTriggerFireHistoryRepository(database);
  }
  async create(input: {
    projectId: string;
    triggerId: string;
    traceId: string | null;
    customGraphId: string | null;
    createdAt: Instant;
    resolvedAt: Instant | null;
  }): Promise<TriggerFire> {
    const row = await this.database.triggerSent.create({
      data: {
        ...input,
        createdAt: toDate(input.createdAt),
        resolvedAt: input.resolvedAt === null ? null : toDate(input.resolvedAt),
      },
    });
    return mapFire(row);
  }
  async findAllStatsForProject(input: {
    projectId: string;
    firesSince: Instant;
  }): Promise<TriggerFireStats[]> {
    const firesSince = toDate(input.firesSince);
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
          createdAt: { gte: firesSince },
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
  async listPageByTriggerId(input: AutomationApiFireHistoryInput): Promise<TriggerFirePage> {
    const { projectId, triggerId, limit, cursor } = input;
    const rows = await this.database.triggerSent.findMany({
      where: {
        projectId,
        triggerId,
        // `createdAt` alone is not unique (a burst shares a millisecond), so
        // the tie breaks on the id or a page boundary inside a burst skips rows.
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
      // One extra row answers "is there more?" without a count query.
      take: limit + 1,
      select: { id: true, triggerId: true, customGraphId: true, createdAt: true, resolvedAt: true },
    });
    const fires = rows.slice(0, limit).map(mapFire);
    const last = fires.at(-1);
    return {
      fires,
      nextCursor: rows.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null,
    };
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
    firesSince: Instant;
  }): Promise<automationContractModule.AutomationFireStats[]> {
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
