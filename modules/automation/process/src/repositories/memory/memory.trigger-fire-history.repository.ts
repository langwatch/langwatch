import type {
  AutomationApiFireHistoryInput,
  AutomationFireStats,
  TriggerFire,
  TriggerFirePage,
  TriggerFireStats,
} from "@langwatch/automation-contract";
import { generate } from "@langwatch/ksuid";
import { toDate, type Instant } from "@langwatch/time";

import { TriggerFireHistoryRepository } from "../trigger-fire-history.repository.ts";
import type { MemoryAutomationStore } from "./memory.automation.store.ts";

export class MemoryTriggerFireHistoryRepository extends TriggerFireHistoryRepository {
  private constructor(private readonly memory: MemoryAutomationStore) {
    super();
  }

  static create(memory: MemoryAutomationStore): MemoryTriggerFireHistoryRepository {
    return new MemoryTriggerFireHistoryRepository(memory);
  }

  create(input: {
    projectId: string;
    triggerId: string;
    traceId: string | null;
    customGraphId: string | null;
    createdAt: Instant;
    resolvedAt: Instant | null;
  }): Promise<TriggerFire> {
    const row = {
      id: generate("triggerfire").toString(),
      triggerId: input.triggerId,
      customGraphId: input.customGraphId,
      createdAt: toDate(input.createdAt),
      resolvedAt: input.resolvedAt === null ? null : toDate(input.resolvedAt),
    };
    this.memory.fires.push({ ...row, projectId: input.projectId });
    return Promise.resolve(row);
  }

  findAllStatsForProject(input: {
    projectId: string;
    firesSince: Instant;
  }): Promise<TriggerFireStats[]> {
    const since = input.firesSince.epochMilliseconds;
    const stats = new Map<string, TriggerFireStats>();
    for (const fire of this.memory.fires) {
      if (fire.projectId !== input.projectId) continue;
      const current = stats.get(fire.triggerId) ?? {
        triggerId: fire.triggerId,
        lastFiredAt: null,
        recentFireCount: 0,
        currentlyFiring: false,
      };
      stats.set(fire.triggerId, {
        triggerId: fire.triggerId,
        lastFiredAt:
          current.lastFiredAt === null || current.lastFiredAt < fire.createdAt
            ? fire.createdAt
            : current.lastFiredAt,
        recentFireCount: current.recentFireCount + (fire.createdAt.getTime() >= since ? 1 : 0),
        currentlyFiring: current.currentlyFiring || fire.resolvedAt === null,
      });
    }
    return Promise.resolve([...stats.values()]);
  }

  findAllRecentByTriggerId(input: {
    projectId: string;
    triggerId: string;
    limit: number;
  }): Promise<TriggerFire[]> {
    return this.findRecent(input);
  }

  listPageByTriggerId(input: AutomationApiFireHistoryInput): Promise<TriggerFirePage> {
    const { cursor, limit } = input;
    const newestFirst = (left: TriggerFire, right: TriggerFire): number =>
      right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id);
    const after = (fire: TriggerFire): boolean =>
      cursor === null ||
      fire.createdAt < cursor.createdAt ||
      (fire.createdAt.getTime() === cursor.createdAt.getTime() && fire.id < cursor.id);
    const rows = this.memory.fires
      .filter((fire) => fire.projectId === input.projectId && fire.triggerId === input.triggerId)
      .map(({ projectId: _projectId, ...fire }) => fire)
      .filter(after)
      .toSorted(newestFirst);
    const fires = rows.slice(0, limit);
    const last = fires.at(-1);
    return Promise.resolve({
      fires,
      nextCursor: rows.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null,
    });
  }

  findAllRecentForProject(input: { projectId: string; limit: number }): Promise<TriggerFire[]> {
    return this.findRecent(input);
  }

  async findStats(input: {
    projectId: string;
    firesSince: Instant;
  }): Promise<AutomationFireStats[]> {
    const stats = await this.findAllStatsForProject(input);
    return stats.map((row) => ({
      triggerId: row.triggerId,
      lastFiredAt: row.lastFiredAt,
      recentFireCount: row.recentFireCount,
    }));
  }

  findRecent(input: {
    projectId: string;
    triggerId?: string;
    limit: number;
  }): Promise<TriggerFire[]> {
    const rows = this.memory.fires
      .filter(
        (fire) =>
          fire.projectId === input.projectId &&
          (input.triggerId === undefined || fire.triggerId === input.triggerId),
      )
      .toSorted((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, input.limit)
      .map((fire) => ({
        id: fire.id,
        triggerId: fire.triggerId,
        customGraphId: fire.customGraphId,
        createdAt: fire.createdAt,
        resolvedAt: fire.resolvedAt,
      }));
    return Promise.resolve(rows);
  }
}
