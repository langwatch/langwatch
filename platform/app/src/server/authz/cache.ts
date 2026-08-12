/**
 * ADR-092 §12 L1 — the in-process, epoch-validated grants cache. A cache
 * entry is valid only while its organization's epoch is unchanged, so a
 * revoked binding is dead on the caller's next request (the grant write
 * bumps the epoch). No epoch available (tests, Redis down, flag off) means
 * no caching — always correct, just slower.
 */
import type { AuthzPrincipalRef, CollectedGrants } from "@langwatch/authz";
import type { PrismaClient } from "@prisma/client";
import { collectGrants } from "./collector";
import { getAuthzEpoch } from "./epoch";

const MAX_ENTRIES = 10_000;

type CacheEntry = { epoch: number; grants: CollectedGrants };

const cache = new Map<string, CacheEntry>();

function cacheEnabled(): boolean {
  // Internal rollout knob — read process.env directly (see epoch.ts).
  return (
    process.env.AUTHZ_EPOCH_CACHE === "1" ||
    process.env.AUTHZ_EPOCH_CACHE === "true"
  );
}

function cacheKey(
  principal: Exclude<AuthzPrincipalRef, { type: "anonymous" }>,
  organizationId: string,
) {
  return `${principal.type}:${principal.id}:${organizationId}`;
}

/**
 * Collect grants for a principal, via the epoch cache when it is enabled and
 * the epoch store is reachable. The epoch reader is injectable for tests.
 */
export async function collectGrantsCached({
  prisma,
  principal,
  organizationId,
  epochReader = getAuthzEpoch,
}: {
  prisma: PrismaClient;
  principal: AuthzPrincipalRef;
  organizationId: string;
  epochReader?: (args: { organizationId: string }) => Promise<number | null>;
}): Promise<CollectedGrants> {
  // Anonymous collects are constant-empty and touch no storage — nothing to
  // cache, and the principal has no id to key on.
  if (!cacheEnabled() || principal.type === "anonymous") {
    return collectGrants({ prisma, principal, organizationId });
  }

  const epoch = await epochReader({ organizationId });
  if (epoch === null) {
    return collectGrants({ prisma, principal, organizationId });
  }

  const key = cacheKey(principal, organizationId);
  const entry = cache.get(key);
  if (entry && entry.epoch === epoch) {
    return entry.grants;
  }

  const grants = await collectGrants({ prisma, principal, organizationId });
  if (cache.size >= MAX_ENTRIES) {
    // Plain FIFO eviction: authz entries are tiny and refresh cheaply, so a
    // smarter LRU buys nothing worth its bookkeeping.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { epoch, grants });
  return grants;
}

/** @internal test hook. */
export function clearAuthzGrantsCacheForTests(): void {
  cache.clear();
}
