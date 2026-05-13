import { TtlCache } from "~/server/utils/ttlCache";
import type {
  TriggerRepository,
  TriggerSummary,
} from "./repositories/trigger.repository";

export class TriggerService {
  private static readonly TTL_MS = 60_000;
  /**
   * Short-term in-flight dedup window. `recordSent` (TriggerSent table) is the
   * durable long-term dedup; this Redis claim prevents concurrent or rapid
   * retry storms from re-dispatching non-idempotent actions (email/Slack)
   * between the start of dispatch and the moment recordSent commits.
   */
  private static readonly DISPATCH_CLAIM_TTL_MS = 24 * 60 * 60 * 1000;

  private readonly cache = new TtlCache<TriggerSummary[]>(
    TriggerService.TTL_MS,
    "triggers:",
  );

  private readonly dispatchClaims = new TtlCache<number>(
    TriggerService.DISPATCH_CLAIM_TTL_MS,
    "triggers:dispatched:",
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

  async hasSentForTrace(params: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean> {
    return this.repo.hasSentForTrace(params);
  }

  async recordSent(params: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<void> {
    return this.repo.recordSent(params);
  }

  /**
   * Atomically claim the dispatch slot for a (trigger, trace) pair. Returns
   * `true` if this caller may proceed to dispatch; `false` if another reactor
   * invocation has already claimed it within the TTL window.
   *
   * The claim is held even when dispatch later fails — for non-idempotent
   * actions (email/Slack) the conservative default is "skip rather than
   * risk duplicate sends." Operators can re-arm the trigger manually if
   * a delivery genuinely failed.
   */
  async claimDispatchSlot(params: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean> {
    const key = `${params.projectId}:${params.triggerId}:${params.traceId}`;
    return this.dispatchClaims.claim(key, Date.now());
  }

  async updateLastRunAt(params: {
    triggerId: string;
    projectId: string;
  }): Promise<void> {
    return this.repo.updateLastRunAt(params);
  }

  async invalidate(projectId: string): Promise<void> {
    await this.cache.delete(projectId);
  }
}
