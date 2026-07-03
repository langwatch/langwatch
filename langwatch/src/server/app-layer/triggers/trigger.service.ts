import { TtlCache } from "~/server/utils/ttlCache";
import type {
  TriggerRepository,
  TriggerSummary,
} from "./repositories/trigger.repository";

export class TriggerService {
  private static readonly TTL_MS = 60_000;

  /**
   * ONE cache over the FULL active-triggers-per-project result. Trace vs
   * graph filters happen on read (both `getActive…` methods delegate to
   * this loader). The prior two-cache design (simp5013 double-cache
   * finding) issued 2× Redis GETs per project using both surfaces and
   * doubled the DB cost on cold start — the underlying `findActiveForProject`
   * is the same call either way, so warming one WAS warming the other.
   */
  private readonly cache = new TtlCache<TriggerSummary[]>(
    TriggerService.TTL_MS,
    "triggers:",
  );

  constructor(private readonly repo: TriggerRepository) {}

  private async loadAll(projectId: string): Promise<TriggerSummary[]> {
    const cached = await this.cache.get(projectId);
    if (cached) return cached;
    const all = await this.repo.findActiveForProject(projectId);
    await this.cache.set(projectId, all);
    return all;
  }

  async getActiveTraceTriggersForProject(
    projectId: string,
  ): Promise<TriggerSummary[]> {
    const all = await this.loadAll(projectId);
    return all.filter((t) => !t.customGraphId);
  }

  /**
   * Active custom-graph triggers for a project (ADR-034 Phase 5).
   * Counterpart to `getActiveTraceTriggersForProject`: filters the
   * SAME `findActiveForProject` read down to rows with `customGraphId`,
   * which is the cron's definition of a graph trigger.
   */
  async getActiveGraphTriggersForProject(
    projectId: string,
  ): Promise<TriggerSummary[]> {
    const all = await this.loadAll(projectId);
    return all.filter((t) => t.customGraphId != null);
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
  }
}
