import type {
  AutomationFireStats,
  TriggerFire,
  TriggerFireStats,
} from "@langwatch/automation-contract";
import { generate } from "@langwatch/ksuid";
import type { Instant } from "@langwatch/time";
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
      createdAt: new Date(input.createdAt.epochMilliseconds),
      resolvedAt:
        input.resolvedAt === null ? null : new Date(input.resolvedAt.epochMilliseconds),
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
        recentFireCount:
          current.recentFireCount + (fire.createdAt.getTime() >= since ? 1 : 0),
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
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
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
