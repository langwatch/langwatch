import { TtlCache } from "../utils/ttlCache";
import type { ResolvedDataPrivacy } from "./dataPrivacy.types";
import type { DataPrivacyPolicyRepository } from "./dataPrivacyPolicy.repository";
import { resolveDataPrivacy } from "./resolveDataPrivacy";

/**
 * Caches the resolved privacy policy for a project so the ingestion hot path
 * doesn't re-walk the PROJECT → DEPARTMENT → TEAM → ORGANIZATION cascade on
 * every event. Keyed by projectId; invalidated whenever a rule at any tier in
 * the project's cascade changes (the writer invalidates affected projects).
 *
 * Row-fetching is delegated to the repository so the scope-chain query has a
 * single definition shared with the policy service: the cache only adds the
 * TTL layer on top. A `null` value means the project has no resolvable scope
 * context (no org anchor); the service maps that to the platform default.
 */
export class DataPrivacyPolicyCache {
  private readonly cache: TtlCache<ResolvedDataPrivacy | null>;

  constructor(private readonly repository: DataPrivacyPolicyRepository) {
    this.cache = new TtlCache(60_000, "data-privacy-policy:");
  }

  async resolve(projectId: string): Promise<ResolvedDataPrivacy | null> {
    const cached = await this.cache.get(projectId);
    if (cached !== undefined) return cached;

    const resolved = await this.loadResolved(projectId);
    await this.cache.set(projectId, resolved);
    return resolved;
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
  ): Promise<ResolvedDataPrivacy | null> {
    const facts = await this.repository.getProjectScopeFacts({ projectId });
    if (!facts) return null;

    const rows = await this.repository.findForProjectChain(facts);
    return resolveDataPrivacy({ rows, facts });
  }
}
