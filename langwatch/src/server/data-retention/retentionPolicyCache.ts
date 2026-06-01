import { resolveScopeChain } from "../scopes/resolveScopeChain";
import { TtlCache } from "../utils/ttlCache";
import type { DataRetentionPolicyRepository } from "./policy/dataRetentionPolicy.repository";
import { type RetentionRow, resolveRetention } from "./resolveRetentionDays";
import type {
  ResolvedRetention,
  RetentionCategory,
} from "./retentionPolicy.schema";
import type { RetentionPolicyResolver } from "./retentionPolicyResolver";

/**
 * Caches the resolved per-category retention for a project so the ingestion
 * hot path doesn't re-walk the PROJECT → TEAM → ORGANIZATION cascade on every
 * event. Keyed by projectId; invalidated whenever a policy at any tier in the
 * project's cascade changes (the writer invalidates affected projects).
 *
 * Row-fetching is delegated to the repository so the scope-chain query has a
 * single definition shared with the policy service — the cache only adds the
 * TTL layer on top.
 */
export class RetentionPolicyCache implements RetentionPolicyResolver {
  private readonly cache: TtlCache<ResolvedRetention | null>;

  constructor(private readonly repository: DataRetentionPolicyRepository) {
    this.cache = new TtlCache(60_000, "retention-policy:");
  }

  async resolve(projectId: string): Promise<ResolvedRetention | null> {
    const cached = await this.cache.get(projectId);
    if (cached !== undefined) return cached;

    const resolved = await this.loadResolved(projectId);
    await this.cache.set(projectId, resolved);
    return resolved;
  }

  async getRetentionDays(
    projectId: string,
    category: RetentionCategory,
  ): Promise<number> {
    const resolved = await this.resolve(projectId);
    return resolved?.[category] ?? 0;
  }

  invalidate(projectId: string): void {
    // Best-effort: a failed cache delete is self-healing because every entry
    // expires on the 60s TTL anyway, so a stale resolution survives at most
    // one TTL window rather than indefinitely. Swallow to keep invalidate()
    // synchronous and non-throwing for its callers (the policy writer).
    this.cache.delete(projectId).catch(() => undefined);
  }

  private async loadResolved(
    projectId: string,
  ): Promise<ResolvedRetention | null> {
    const ctx = await this.repository.getProjectScopeContext(projectId);
    if (!ctx) return null;

    const rows = (await this.repository.findForProjectChain(
      ctx,
    )) as RetentionRow[];
    return resolveRetention({ rows, chain: resolveScopeChain(ctx) });
  }
}
