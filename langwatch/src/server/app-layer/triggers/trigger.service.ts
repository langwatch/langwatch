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

  /**
   * Separate cache namespace for graph triggers so the trace-trigger
   * cache (used hot by the outbox `handleSettle` path) stays untouched
   * when the heartbeat / graph-eval reactor refreshes its own list.
   */
  private readonly graphCache = new TtlCache<TriggerSummary[]>(
    TriggerService.TTL_MS,
    "graph-triggers:",
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
   * Active custom-graph triggers for a project (ADR-034 Phase 5).
   * Counterpart to `getActiveTraceTriggersForProject`: filters the
   * SAME `findActiveForProject` read down to rows with `customGraphId`,
   * which is the cron's definition of a graph trigger
   * (cron.ts:421 `triggers.filter((t) => t.customGraphId)`).
   */
  async getActiveGraphTriggersForProject(
    projectId: string,
  ): Promise<TriggerSummary[]> {
    const cached = await this.graphCache.get(projectId);
    if (cached) return cached;

    const all = await this.repo.findActiveForProject(projectId);
    const graphOnly = all.filter((t) => t.customGraphId != null);

    await this.graphCache.set(projectId, graphOnly);

    return graphOnly;
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

  /**
   * Read-only existence check for a (triggerId, traceId) claim. The
   * outbox cadence dispatcher uses this to skip pairs already dispatched
   * in a prior batch while keeping the actual `claimSend` write deferred
   * until after a successful provider call — see `dispatcher.ts`.
   */
  async isSendClaimed(params: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean> {
    return this.repo.isSendClaimed(params);
  }

  async updateLastRunAt(triggerId: string, projectId: string): Promise<void> {
    return this.repo.updateLastRunAt(triggerId, projectId);
  }

  async invalidate(projectId: string): Promise<void> {
    await this.cache.delete(projectId);
    await this.graphCache.delete(projectId);
  }
}
