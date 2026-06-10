import { TtlCache } from "~/server/utils/ttlCache";
import type {
  TriggerRepository,
  TriggerSummary,
} from "./repositories/trigger.repository";

export class TriggerService {
  private static readonly TTL_MS = 60_000;

  private readonly cache = new TtlCache<TriggerSummary[]>(
    TriggerService.TTL_MS,
    "triggers:",
  );

  constructor(private readonly repo: TriggerRepository) {}

  async getActiveTraceTriggersForProject(
    projectId: string,
  ): Promise<TriggerSummary[]> {
    const cached = await this.cache.get(projectId);
    if (cached) return cached;

    const all = await this.repo.findActiveForProject(projectId);
    const traceOnly = all.filter((t) => !t.customGraphId);

    await this.cache.set(projectId, traceOnly);

    return traceOnly;
  }

  /**
   * Atomically claim (triggerId, traceId). Returns true on first claim,
   * false if another reactor already claimed it. Side effects (email,
   * slack, dataset write) must run only when this returns true to avoid
   * double-fire on concurrent dispatch or reactor retry.
   */
  async claimSend(params: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean> {
    return this.repo.claimSend(params);
  }

  async updateLastRunAt(
    triggerId: string,
    projectId: string,
  ): Promise<void> {
    return this.repo.updateLastRunAt(triggerId, projectId);
  }

  async invalidate(projectId: string): Promise<void> {
    await this.cache.delete(projectId);
  }
}
