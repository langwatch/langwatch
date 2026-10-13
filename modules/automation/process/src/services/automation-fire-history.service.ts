import type {
  AutomationApiFireHistoryInput,
  TriggerFire,
  TriggerFirePage,
  TriggerFireStats,
} from "@langwatch/automation-contract";
import type { Instant } from "@langwatch/time";

import type { AutomationClock } from "../repositories/automation.repositories.ts";
import type { TriggerFireHistoryRepository } from "../repositories/trigger-fire-history.repository.ts";

/** A trigger's fire history: the pages, stats and recent fires read, and a fire recorded. */
export class AutomationFireHistoryService {
  static create(deps: {
    history: TriggerFireHistoryRepository;
    clock: AutomationClock;
  }): AutomationFireHistoryService {
    return new AutomationFireHistoryService(deps.history, deps.clock);
  }

  private constructor(
    private readonly history: TriggerFireHistoryRepository,
    private readonly clock: AutomationClock,
  ) {}

  /** Main's view read: a page of fires, empty (not refused) for a trigger that is not there. */
  listPage(input: AutomationApiFireHistoryInput): Promise<TriggerFirePage> {
    return this.history.listPageByTriggerId(input);
  }

  getStats(input: { projectId: string }): Promise<TriggerFireStats[]> {
    return this.history.findAllStatsForProject({
      projectId: input.projectId,
      firesSince: this.clock.now().subtract({ milliseconds: 30 * 24 * 60 * 60 * 1000 }),
    });
  }

  getRecent(input: {
    projectId: string;
    triggerId?: string;
    limit: number;
  }): Promise<TriggerFire[]> {
    return input.triggerId
      ? this.history.findAllRecentByTriggerId({
          projectId: input.projectId,
          triggerId: input.triggerId,
          limit: input.limit,
        })
      : this.history.findAllRecentForProject({
          projectId: input.projectId,
          limit: input.limit,
        });
  }

  record(input: {
    projectId: string;
    triggerId: string;
    traceId?: string | null;
    customGraphId?: string | null;
    createdAt: Instant;
    resolvedAt?: Instant | null;
  }): Promise<TriggerFire> {
    return this.history.create({
      projectId: input.projectId,
      triggerId: input.triggerId,
      traceId: input.traceId ?? null,
      customGraphId: input.customGraphId ?? null,
      createdAt: input.createdAt,
      resolvedAt: input.resolvedAt ?? null,
    });
  }
}
