import type { PrismaClient } from "@prisma/client";
import { PrismaTriggerFireHistoryRepository } from "./repositories/trigger-fire-history.prisma.repository";
import type {
  TriggerFire,
  TriggerFireHistoryRepository,
  TriggerFireStats,
} from "./repositories/trigger-fire-history.repository";

export type { TriggerFire, TriggerFireStats };

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Read-side service over `TriggerSent` fire history. Backs the automations
 * list metrics (last fired, fires in the last 30 days, open graph-alert
 * incidents) and the view drawer's "Recent fires" panel.
 */
export class TriggerFireHistoryService {
  constructor(private readonly repo: TriggerFireHistoryRepository) {}

  static create(prisma: PrismaClient): TriggerFireHistoryService {
    return new TriggerFireHistoryService(
      new PrismaTriggerFireHistoryRepository(prisma),
    );
  }

  /**
   * Per-trigger fire rollup for a project. `recentFireCount` covers the
   * trailing 30 days; triggers that never fired have no entry (the caller
   * treats missing as "never fired / 0 / not firing").
   */
  async getAllFireStatsForProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<TriggerFireStats[]> {
    return this.repo.findAllStatsForProject({
      projectId,
      firesSince: new Date(Date.now() - THIRTY_DAYS_MS),
    });
  }

  /** Latest fires for one trigger, newest first, capped at `limit`. */
  async getAllRecentFiresForTrigger({
    projectId,
    triggerId,
    limit,
  }: {
    projectId: string;
    triggerId: string;
    limit: number;
  }): Promise<TriggerFire[]> {
    return this.repo.findAllRecentByTriggerId({ projectId, triggerId, limit });
  }
}
